from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
import joblib
import numpy as np

from features import (
    GOLD_FEATURES,
    HORIZON_TRADING_DAYS,
    USDINR_FEATURES,
    build_feature_dataframe,
)
from train_model import MODEL_PATH, train_all

ROOT_DIR = Path(__file__).resolve().parent.parent
OUT_FILE = ROOT_DIR / "public" / "data" / "forecast_latest.json"


def export_json():
    if not MODEL_PATH.exists():
        train_all()

    bundle = joblib.load(MODEL_PATH)
    df = build_feature_dataframe(period="2y")

    recent = df.tail(30)
    last_close = float(recent["gold_close"].iloc[-1])
    prev_close = float(recent["gold_close"].iloc[-2]) if len(recent) > 1 else last_close
    change_24h_pct = ((last_close - prev_close) / max(1e-9, prev_close)) * 100.0

    history_ratios = [
        {
            "dateLabel": dt.strftime("%b %d"),
            "mult": round(float(val / last_close), 6),
        }
        for dt, val in zip(recent.index, recent["gold_close"])
    ]

    X_gold = df[GOLD_FEATURES].ffill().iloc[-1:].to_numpy(dtype=np.float32)
    X_fx = df[USDINR_FEATURES].ffill().iloc[-1:].to_numpy(dtype=np.float32)

    horizons_out = {}
    for cal_days, td in HORIZON_TRADING_DAYS.items():
        h_pack = bundle["horizons"][cal_days]
        sigma_h = float(df["norm_sigma_annual"].iloc[-1]) * float(np.sqrt(td / 252.0))

        q10 = float(h_pack["models"][0.10].predict(X_gold)[0]) * sigma_h
        q50 = float(h_pack["models"][0.50].predict(X_gold)[0]) * sigma_h
        q90 = float(h_pack["models"][0.90].predict(X_gold)[0]) * sigma_h
        q10, q50, q90 = sorted([q10, q50, q90])

        cqr = float(h_pack["cqr_delta"]) * sigma_h
        r10, r50, r90 = q10 - cqr, q50, q90 + cqr

        fx_pack = bundle.get("usdinr_horizons", {}).get(cal_days)
        if fx_pack:
            fx10 = float(fx_pack["models"][0.10].predict(X_fx)[0]) - float(fx_pack["cqr_delta"])
            fx50 = float(fx_pack["models"][0.50].predict(X_fx)[0])
            fx90 = float(fx_pack["models"][0.90].predict(X_fx)[0]) + float(fx_pack["cqr_delta"])
            fx10, fx50, fx90 = sorted([fx10, fx50, fx90])
        else:
            fx10, fx50, fx90 = 0.0, 0.0, 0.0

        horizons_out[str(cal_days)] = {
            "gold_logret": {"r10": round(r10, 6), "r50": round(r50, 6), "r90": round(r90, 6)},
            "usdinr_logret": {"r10": round(fx10, 6), "r50": round(fx50, 6), "r90": round(fx90, 6)},
            "metrics": h_pack["metrics"],
            "top_drivers": h_pack["top_drivers"],
        }

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "trained_at": bundle.get("trained_at"),
        "engine": "GitHub Actions · LightGBM + Linear + CFTC/GVZ",
        "spot_usd_oz_close": round(last_close, 2),
        "history_30d_ratios": history_ratios,
        "macro": {
            "realYield10y": round(float(df["real_yield_10y"].iloc[-1]), 2),
            "breakevenInfl": round(float(df["breakeven_infl"].iloc[-1]), 2),
            "dxy": round(float(df["dxy"].iloc[-1]), 2),
            "gvz": round(float(df["gvz_level"].iloc[-1]), 2),
            "cotMmNetPctOi": round(float(df["cot_mm_net_pct_oi"].iloc[-1]), 1),
            "brentUsd": round(float(df["brent"].iloc[-1]), 2) if "brent" in df.columns and np.isfinite(df["brent"].iloc[-1]) else 74.5,
            "change24hPct": round(change_24h_pct, 2),
        },
        "horizons": horizons_out,
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Exported ML snapshot to {OUT_FILE}")


if __name__ == "__main__":
    export_json()
