from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import joblib
import lightgbm as lgb
import numpy as np
from sklearn.linear_model import QuantileRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import RobustScaler

from features import (
    GOLD_FEATURES,
    HORIZON_TRADING_DAYS,
    USDINR_FEATURES,
    HybridQuantileRegressor,
    build_feature_dataframe,
)

ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts"
MODEL_PATH = ARTIFACTS_DIR / "gold_models.joblib"
QUANTILES = [0.10, 0.50, 0.90]


def make_hybrid_model(alpha: float, tree_weight: float = 0.72) -> tuple:
    tree = lgb.LGBMRegressor(
        objective="quantile",
        alpha=alpha,
        n_estimators=280,
        learning_rate=0.025,
        max_depth=4,
        num_leaves=10,
        min_child_samples=45,
        subsample=0.78,
        subsample_freq=1,
        colsample_bytree=0.70,
        reg_alpha=0.8,
        reg_lambda=2.0,
        random_state=42,
        verbose=-1,
    )
    linear = make_pipeline(RobustScaler(), QuantileRegressor(quantile=alpha, alpha=0.05))
    return tree, linear, tree_weight


def purged_walk_forward_folds(n_rows: int, purge_gap: int, n_folds: int = 5):
    initial_train = int(n_rows * 0.48)
    remaining = n_rows - initial_train
    val_size = max(55, remaining // n_folds)
    folds = []
    for k in range(n_folds):
        tr_end = initial_train + k * val_size
        va_start = tr_end + purge_gap
        va_end = min(n_rows, va_start + val_size)
        if va_start >= n_rows or (va_end - va_start) < 25:
            break
        folds.append((np.arange(0, tr_end), np.arange(va_start, va_end)))
    return folds


def fit_quantile_suite(df_h, feature_cols: list[str], target_col: str, td: int, raw_target_col: str | None = None, sigma_col: str | None = None):
    X = df_h[feature_cols].to_numpy(dtype=np.float32)
    y = df_h[target_col].to_numpy(dtype=np.float32)
    y_raw = df_h[raw_target_col].to_numpy(dtype=np.float32) if raw_target_col else y
    sigma_h = (df_h[sigma_col].to_numpy(dtype=np.float32) * np.sqrt(td / 252.0)) if sigma_col else np.ones_like(y)

    folds = purged_walk_forward_folds(len(df_h), purge_gap=td, n_folds=5)
    oof_preds = {q: [] for q in QUANTILES}
    oof_raw_true, oof_sigma = [], []

    for tr_idx, va_idx in folds:
        X_tr, y_tr = X[tr_idx], y[tr_idx]
        X_va = X[va_idx]
        for q in QUANTILES:
            tree, lin, w = make_hybrid_model(q)
            tree.fit(X_tr, y_tr)
            lin.fit(X_tr, y_tr)
            oof_preds[q].append(HybridQuantileRegressor(tree, lin, w).predict(X_va))
        oof_raw_true.append(y_raw[va_idx])
        oof_sigma.append(sigma_h[va_idx])

    y_raw_oof = np.concatenate(oof_raw_true)
    sig_oof = np.concatenate(oof_sigma)
    q10_oof = np.concatenate(oof_preds[0.10]) * sig_oof
    q50_oof = np.concatenate(oof_preds[0.50]) * sig_oof
    q90_oof = np.concatenate(oof_preds[0.90]) * sig_oof

    stacked = np.sort(np.vstack([q10_oof, q50_oof, q90_oof]), axis=0)
    q10_oof, q50_oof, q90_oof = stacked[0], stacked[1], stacked[2]

    scores = np.maximum((q10_oof - y_raw_oof) / sig_oof, (y_raw_oof - q90_oof) / sig_oof)
    conf_level = min(0.99, 0.80 * (1.0 + 1.0 / len(scores)))
    cqr_delta = float(max(0.0, np.quantile(scores, conf_level)))

    cal_low = q10_oof - cqr_delta * sig_oof
    cal_high = q90_oof + cqr_delta * sig_oof

    dir_acc = float(np.mean((q50_oof >= 0) == (y_raw_oof >= 0)) * 100.0)
    cov_80 = float(np.mean((y_raw_oof >= cal_low) & (y_raw_oof <= cal_high)) * 100.0)
    mae_pct = float(np.mean(np.abs(np.expm1(q50_oof) - np.expm1(y_raw_oof))) * 100.0)

    final_models = {}
    for q in QUANTILES:
        tree, lin, w = make_hybrid_model(q)
        tree.fit(X, y)
        lin.fit(X, y)
        final_models[q] = HybridQuantileRegressor(tree, lin, w)

    imp = final_models[0.50].tree_model.feature_importances_
    imp_pct = (imp / max(1, imp.sum())) * 100.0
    top_drivers = sorted(
        [{"feature": f, "importance_pct": round(float(p), 1)} for f, p in zip(feature_cols, imp_pct)],
        key=lambda x: x["importance_pct"],
        reverse=True,
    )[:6]

    return {
        "models": final_models,
        "cqr_delta": cqr_delta,
        "metrics": {
            "directional_accuracy_pct": round(dir_acc, 1),
            "empirical_coverage_80_pct": round(cov_80, 1),
            "mae_pct": round(mae_pct, 2),
            "oof_samples": int(len(y_raw_oof)),
        },
        "top_drivers": top_drivers,
    }


def train_all():
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    print("[1/3] Downloading 10Y macro, CFTC COT, GVZ options vol, yields & FX...")
    raw_df = build_feature_dataframe(period="10y")

    bundle = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "gold_features": GOLD_FEATURES,
        "usdinr_features": USDINR_FEATURES,
        "horizons": {},
        "usdinr_horizons": {},
    }

    print("[2/3] Training Vol-Normalized Hybrid Gold + Dedicated USD/INR Quantile Models...")
    for cal_days, td in HORIZON_TRADING_DAYS.items():
        df_g = raw_df.dropna(subset=GOLD_FEATURES + [f"target_norm_gold_{cal_days}d", f"target_raw_gold_{cal_days}d"]).copy()
        g_res = fit_quantile_suite(
            df_g, GOLD_FEATURES, f"target_norm_gold_{cal_days}d", td,
            raw_target_col=f"target_raw_gold_{cal_days}d", sigma_col="norm_sigma_annual",
        )
        bundle["horizons"][cal_days] = g_res

        df_fx = raw_df.dropna(subset=USDINR_FEATURES + [f"target_raw_usdinr_{cal_days}d"]).copy()
        fx_res = fit_quantile_suite(df_fx, USDINR_FEATURES, f"target_raw_usdinr_{cal_days}d", td)
        bundle["usdinr_horizons"][cal_days] = fx_res

        gm = g_res["metrics"]
        fm = fx_res["metrics"]
        print(
            f"  +{cal_days}D | Gold DirAcc: {gm['directional_accuracy_pct']:.1f}% "
            f"(80% Cov: {gm['empirical_coverage_80_pct']:.1f}%, MAE: {gm['mae_pct']:.2f}%) | "
            f"USD/INR DirAcc: {fm['directional_accuracy_pct']:.1f}%"
        )

    joblib.dump(bundle, MODEL_PATH)
    print(f"[3/3] Saved Hybrid Ensemble Bundle to {MODEL_PATH}")


if __name__ == "__main__":
    train_all()
