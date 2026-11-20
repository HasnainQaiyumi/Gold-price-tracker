from __future__ import annotations

import io
import httpx
import numpy as np
import pandas as pd
import yfinance as yf
from sklearn.base import BaseEstimator, RegressorMixin

HORIZON_TRADING_DAYS = {7: 5, 30: 21, 90: 63}

GOLD_FEATURES = [
    "ret_1d", "ret_5d", "ret_20d", "ret_60d",
    "vol_10d", "vol_30d", "vol_regime", "atr_14_pct",
    "gvz_level", "gvz_pct_rank_252", "vol_risk_premium",
    "dist_ema20", "dist_sma50", "dist_sma200", "rsi_14", "bollinger_z",
    "real_yield_10y", "real_yield_chg_5d", "real_yield_chg_20d",
    "breakeven_infl", "breakeven_chg_20d", "yield_curve_10y2y", "hy_credit_spread",
    "dxy_ret_5d", "dxy_ret_20d", "dxy_dist_sma50",
    "vix_level", "vix_chg_5d",
    "gsr_zscore_60d", "copper_gold_chg_20d", "miners_bullion_chg_10d", "gld_vol_ratio",
    "cot_mm_net_pct_oi", "cot_mm_4w_chg", "cot_mm_pct_rank_104w",
    "sin_doy", "cos_doy", "is_festive_q4",
]

USDINR_FEATURES = [
    "usdinr_ret_5d", "usdinr_ret_20d", "usdinr_dist_sma50", "usdinr_rsi_14",
    "dxy_ret_5d", "dxy_ret_20d", "dxy_dist_sma50",
    "brent_ret_5d", "brent_ret_20d",
    "real_yield_10y", "real_yield_chg_20d", "hy_credit_spread", "vix_level",
]


class HybridQuantileRegressor(BaseEstimator, RegressorMixin):
    """Picklable hybrid quantile ensemble: Tree Nonlinearity + Robust Linear Macro Slope."""

    def __init__(self, tree_model, linear_model, tree_weight: float = 0.72):
        self.tree_model = tree_model
        self.linear_model = linear_model
        self.tree_weight = tree_weight

    def predict(self, X: np.ndarray) -> np.ndarray:
        p_tree = self.tree_model.predict(X)
        p_lin = self.linear_model.predict(X)
        return self.tree_weight * p_tree + (1.0 - self.tree_weight) * p_lin


def fetch_fred_csv(series_id: str) -> pd.Series:
    try:
        url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(url)
            resp.raise_for_status()
        df = pd.read_csv(io.StringIO(resp.text))
        date_col = "observation_date" if "observation_date" in df.columns else df.columns[0]
        val_col = series_id if series_id in df.columns else df.columns[1]
        df[date_col] = pd.to_datetime(df[date_col])
        df[val_col] = pd.to_numeric(df[val_col], errors="coerce")
        return df.set_index(date_col)[val_col].sort_index().rename(series_id)
    except Exception:
        return pd.Series(dtype=float, name=series_id)


def fetch_cftc_gold_cot(limit: int = 600) -> pd.DataFrame:
    """
    Fetch COMEX Gold Disaggregated COT (088691) from publicreporting.cftc.gov.
    Shifts Tuesday report_date by +3 days -> Friday release date to eliminate lookahead.
    """
    try:
        url = (
            "https://publicreporting.cftc.gov/resource/kh3c-gbw2.json"
            f"?$where=cftc_contract_market_code='088691'"
            f"&$order=report_date_as_yyyy_mm_dd DESC&$limit={limit}"
        )
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(url)
            resp.raise_for_status()
        rows = resp.json()
        if not rows:
            return pd.DataFrame()
        df = pd.DataFrame(rows)
        df["pub_date"] = pd.to_datetime(df["report_date_as_yyyy_mm_dd"]).dt.tz_localize(None) + pd.Timedelta(days=3)
        for col in ["open_interest_all", "m_money_positions_long_all", "m_money_positions_short_all"]:
            df[col] = pd.to_numeric(df[col], errors="coerce")
        df = df.dropna(subset=["open_interest_all", "m_money_positions_long_all", "m_money_positions_short_all"])
        df = df.set_index("pub_date").sort_index()
        df = df[~df.index.duplicated(keep="last")]
        df["cot_mm_net_pct_oi"] = (
            (df["m_money_positions_long_all"] - df["m_money_positions_short_all"])
            / df["open_interest_all"].replace(0, np.nan)
        ) * 100.0
        df["cot_mm_4w_chg"] = df["cot_mm_net_pct_oi"] - df["cot_mm_net_pct_oi"].shift(4)
        df["cot_mm_pct_rank_104w"] = df["cot_mm_net_pct_oi"].rolling(104, min_periods=20).rank(pct=True) * 100.0
        return df[["cot_mm_net_pct_oi", "cot_mm_4w_chg", "cot_mm_pct_rank_104w"]]
    except Exception:
        return pd.DataFrame()


def fetch_yf_ohlcv(ticker: str, period: str = "10y") -> pd.DataFrame:
    df = yf.download(ticker, period=period, interval="1d", progress=False, auto_adjust=True)
    if df.empty:
        return pd.DataFrame()
    if isinstance(df.columns, pd.MultiIndex):
        df = df.xs(ticker, axis=1, level=1) if ticker in df.columns.get_level_values(1) else df.droplevel(1, axis=1)
    df.index = pd.to_datetime(df.index).tz_localize(None)
    return df.sort_index()


def compute_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return (100 - (100 / (1 + rs))).fillna(50.0)


def build_feature_dataframe(period: str = "10y") -> pd.DataFrame:
    gold = fetch_yf_ohlcv("GC=F", period=period)
    if gold.empty:
        raise RuntimeError("Failed to download GC=F gold data.")

    def close_of(t: str, name: str) -> pd.Series:
        d = fetch_yf_ohlcv(t, period=period)
        return d["Close"].rename(name) if not d.empty else pd.Series(dtype=float, name=name)

    silver = close_of("SI=F", "silver")
    copper = close_of("HG=F", "copper")
    brent = close_of("BZ=F", "brent")
    dxy = close_of("DX-Y.NYB", "dxy")
    usdinr = close_of("INR=X", "usdinr")
    vix = close_of("^VIX", "vix")
    gvz = close_of("^GVZ", "gvz")
    gdx = close_of("GDX", "gdx")
    gld_df = fetch_yf_ohlcv("GLD", period=period)
    gld = gld_df["Close"].rename("gld") if not gld_df.empty else pd.Series(dtype=float, name="gld")
    gld_vol = gld_df["Volume"].rename("gld_vol") if not gld_df.empty else pd.Series(dtype=float, name="gld_vol")

    dfii10 = fetch_fred_csv("DFII10")
    dgs10 = fetch_fred_csv("DGS10")
    t10y2y = fetch_fred_csv("T10Y2Y")
    hy_oas = fetch_fred_csv("BAMLH0A0HYM2")
    cot_df = fetch_cftc_gold_cot(limit=600)

    df = pd.DataFrame({
        "gold_close": gold["Close"],
        "gold_high": gold["High"],
        "gold_low": gold["Low"],
    })
    for s in [silver, copper, brent, dxy, usdinr, vix, gvz, gdx, gld, gld_vol, dfii10, dgs10, t10y2y, hy_oas]:
        if not s.empty:
            df = df.join(s, how="left")
        else:
            df[s.name] = np.nan

    if not cot_df.empty:
        df = df.join(cot_df, how="left")
    else:
        for col in ["cot_mm_net_pct_oi", "cot_mm_4w_chg", "cot_mm_pct_rank_104w"]:
            df[col] = np.nan

    df = df.ffill().dropna(subset=["gold_close", "dxy", "usdinr", "silver"])

    c = df["gold_close"]
    h = df["gold_high"].fillna(c)
    l = df["gold_low"].fillna(c)

    df["ret_1d"] = np.log(c / c.shift(1))
    df["ret_5d"] = np.log(c / c.shift(5))
    df["ret_20d"] = np.log(c / c.shift(20))
    df["ret_60d"] = np.log(c / c.shift(60))

    df["vol_10d"] = df["ret_1d"].rolling(10).std() * np.sqrt(252)
    df["vol_30d"] = df["ret_1d"].rolling(30).std() * np.sqrt(252)
    df["vol_regime"] = (df["vol_10d"] / df["vol_30d"].replace(0, np.nan)).fillna(1.0)

    prev_c = c.shift(1)
    tr = pd.concat([h - l, (h - prev_c).abs(), (l - prev_c).abs()], axis=1).max(axis=1)
    df["atr_14_pct"] = tr.rolling(14).mean() / c

    df["gvz_level"] = df["gvz"].ffill().fillna(df["vol_30d"] * 100.0)
    df["gvz_pct_rank_252"] = df["gvz_level"].rolling(252, min_periods=30).rank(pct=True).fillna(0.5) * 100.0
    df["vol_risk_premium"] = (df["gvz_level"] / 100.0) - df["vol_30d"]
    df["norm_sigma_annual"] = np.clip(df["gvz_level"] / 100.0, 0.08, 0.65)

    ema20 = c.ewm(span=20, adjust=False).mean()
    sma50 = c.rolling(50).mean()
    sma200 = c.rolling(200).mean()
    df["dist_ema20"] = (c / ema20) - 1.0
    df["dist_sma50"] = (c / sma50) - 1.0
    df["dist_sma200"] = (c / sma200) - 1.0
    df["rsi_14"] = compute_rsi(c, 14)
    df["bollinger_z"] = ((c - c.rolling(20).mean()) / c.rolling(20).std().replace(0, np.nan)).fillna(0.0)

    df["real_yield_10y"] = df["DFII10"].ffill().fillna(2.5)
    df["real_yield_chg_5d"] = (df["real_yield_10y"] - df["real_yield_10y"].shift(5)).fillna(0.0)
    df["real_yield_chg_20d"] = (df["real_yield_10y"] - df["real_yield_10y"].shift(20)).fillna(0.0)
    df["breakeven_infl"] = (df["DGS10"] - df["DFII10"]).ffill().fillna(2.25)
    df["breakeven_chg_20d"] = (df["breakeven_infl"] - df["breakeven_infl"].shift(20)).fillna(0.0)
    df["yield_curve_10y2y"] = df["T10Y2Y"].ffill().fillna(0.2)
    df["hy_credit_spread"] = df["BAMLH0A0HYM2"].ffill().fillna(3.2)

    df["dxy_ret_5d"] = np.log(df["dxy"] / df["dxy"].shift(5))
    df["dxy_ret_20d"] = np.log(df["dxy"] / df["dxy"].shift(20))
    df["dxy_dist_sma50"] = (df["dxy"] / df["dxy"].rolling(50).mean()) - 1.0

    fx = df["usdinr"]
    df["usdinr_ret_5d"] = np.log(fx / fx.shift(5))
    df["usdinr_ret_20d"] = np.log(fx / fx.shift(20))
    df["usdinr_dist_sma50"] = (fx / fx.rolling(50).mean()) - 1.0
    df["usdinr_rsi_14"] = compute_rsi(fx, 14)

    df["brent_ret_5d"] = np.log(df["brent"] / df["brent"].shift(5)).fillna(0.0)
    df["brent_ret_20d"] = np.log(df["brent"] / df["brent"].shift(20)).fillna(0.0)

    df["vix_level"] = df["vix"].ffill().fillna(18.0)
    df["vix_chg_5d"] = (df["vix_level"] - df["vix_level"].shift(5)).fillna(0.0)

    gsr = c / df["silver"]
    df["gsr_zscore_60d"] = ((gsr - gsr.rolling(60).mean()) / gsr.rolling(60).std().replace(0, np.nan)).fillna(0.0)

    cg = df["copper"] / c
    df["copper_gold_chg_20d"] = np.log(cg / cg.shift(20)).fillna(0.0)

    mg = df["gdx"] / df["gld"]
    df["miners_bullion_chg_10d"] = np.log(mg / mg.shift(10)).fillna(0.0)
    df["gld_vol_ratio"] = (df["gld_vol"].rolling(5).mean() / df["gld_vol"].rolling(30).mean().replace(0, np.nan)).fillna(1.0)

    df["cot_mm_net_pct_oi"] = df["cot_mm_net_pct_oi"].ffill().fillna(20.0)
    df["cot_mm_4w_chg"] = df["cot_mm_4w_chg"].ffill().fillna(0.0)
    df["cot_mm_pct_rank_104w"] = df["cot_mm_pct_rank_104w"].ffill().fillna(50.0)

    doy = df.index.dayofyear
    df["sin_doy"] = np.sin(2 * np.pi * doy / 365.25)
    df["cos_doy"] = np.cos(2 * np.pi * doy / 365.25)
    df["is_festive_q4"] = df.index.month.isin([10, 11]).astype(float)

    for cal_days, td in HORIZON_TRADING_DAYS.items():
        horizon_scale = df["norm_sigma_annual"] * np.sqrt(td / 252.0)
        df[f"target_norm_gold_{cal_days}d"] = np.log(c.shift(-td) / c) / horizon_scale
        df[f"target_raw_gold_{cal_days}d"] = np.log(c.shift(-td) / c)
        df[f"target_raw_usdinr_{cal_days}d"] = np.log(fx.shift(-td) / fx)

    return df
