"""
Financial Profile — the single source of truth shared across all skills.

Every skill reads from and writes to this profile. The `extensions` dict
allows new skills (insurance, estate, etc.) to register their own schemas
without modifying the core model.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
import json
from typing import Any


# ─── Enums ─────────────────────────────────────────────────────────────────────

class FilingStatus(str, Enum):
    SINGLE = "single"
    MARRIED_FILING_JOINTLY = "married_filing_jointly"
    MARRIED_FILING_SEPARATELY = "married_filing_separately"
    HEAD_OF_HOUSEHOLD = "head_of_household"


class AccountTaxTreatment(str, Enum):
    TAX_FREE = "tax_free"           # Roth IRA, Roth 401k, HSA (qualified)
    TAX_DEFERRED = "tax_deferred"   # Traditional 401k, Traditional IRA, 457b
    TAXABLE = "taxable"             # Brokerage, ESPP, Crypto
    CASH = "cash"                   # HYSA, Checking, Money Market


class AssetClass(str, Enum):
    US_EQUITY_LARGE = "us_equity_large"
    US_EQUITY_SMALL = "us_equity_small"
    INTL_EQUITY_DEVELOPED = "intl_equity_developed"
    INTL_EQUITY_EMERGING = "intl_equity_emerging"
    US_BONDS = "us_bonds"
    INTL_BONDS = "intl_bonds"
    REITS = "reits"
    TIPS = "tips"
    COMMODITIES = "commodities"
    CRYPTO = "crypto"
    CASH_EQUIVALENT = "cash_equivalent"


class RiskTolerance(str, Enum):
    CONSERVATIVE = "conservative"
    MODERATE = "moderate"
    AGGRESSIVE = "aggressive"
    VERY_AGGRESSIVE = "very_aggressive"


# ─── Data Classes ──────────────────────────────────────────────────────────────

@dataclass
class Person:
    name: str
    age: int
    retirement_age: int = 65
    is_primary: bool = False


@dataclass
class IncomeStream:
    source: str              # "salary", "rsu", "rental", "business", "pension"
    annual_amount: float
    is_w2: bool = True
    employer: str = ""
    frequency: str = "biweekly"  # biweekly, monthly, quarterly, annual


@dataclass
class Holding:
    ticker: str
    shares: float
    asset_class: AssetClass
    cost_basis_per_share: float = 0.0
    dividend_yield: float = 0.0        # annual %
    turnover_rate: float = 0.0         # annual % (for funds)
    expense_ratio: float = 0.0         # annual %


@dataclass
class Account:
    id: str
    name: str
    institution: str
    tax_treatment: AccountTaxTreatment
    balance: float
    annual_contribution_limit: float | None = None  # None = no IRS cap
    ytd_contribution: float = 0.0
    target_allocation_pct: float = 0.0              # % of total input
    holdings: list[Holding] = field(default_factory=list)
    employer_match_pct: float = 0.0                 # e.g., 0.04 = 4% match
    employer_match_limit: float = 0.0               # dollar cap on match


@dataclass
class Goal:
    name: str
    target_amount: float
    target_date: str       # ISO date "2030-06-01"
    priority: int = 1      # 1 = highest
    current_progress: float = 0.0
    monthly_contribution: float = 0.0


@dataclass
class LiquidityRequirement:
    purpose: str           # "emergency_fund", "house_down_payment", etc.
    amount: float
    timeframe_months: int  # how soon you might need it


@dataclass
class TaxSnapshot:
    filing_status: FilingStatus = FilingStatus.SINGLE
    state: str = "CA"
    estimated_agi: float = 0.0
    marginal_federal_rate: float = 0.32
    marginal_state_rate: float = 0.093
    long_term_cap_gains_rate: float = 0.15
    net_investment_income_tax: float = 0.038  # 3.8% NIIT


@dataclass
class MonthlySnapshot:
    month: str             # "2025-01", "2025-02", etc.
    tax_free: float = 0.0
    tax_deferred: float = 0.0
    taxable: float = 0.0
    cash: float = 0.0


@dataclass
class FinancialProfile:
    """The complete financial picture. Skills read/write specific sections."""

    # Identity & situation
    household: list[Person] = field(default_factory=list)
    income: list[IncomeStream] = field(default_factory=list)

    # Accounts — the core of the system
    accounts: list[Account] = field(default_factory=list)

    # Goals drive all recommendations
    goals: list[Goal] = field(default_factory=list)

    # Constraints & preferences
    risk_tolerance: RiskTolerance = RiskTolerance.MODERATE
    liquidity_needs: list[LiquidityRequirement] = field(default_factory=list)
    tax: TaxSnapshot = field(default_factory=TaxSnapshot)

    # Monthly tracking
    current_month: int = 6  # 1-indexed
    current_year: int = 2025
    monthly_history: list[MonthlySnapshot] = field(default_factory=list)

    # Planning parameters
    total_annual_investable: float = 150000.0
    target_emergency_fund: float = 18000.0

    # Extensible — new skills register their own data here
    extensions: dict[str, Any] = field(default_factory=dict)

    # ─── Computed Properties ───────────────────────────────────────────────

    @property
    def total_balance(self) -> float:
        return sum(a.balance for a in self.accounts)

    @property
    def accounts_by_treatment(self) -> dict[AccountTaxTreatment, list[Account]]:
        result: dict[AccountTaxTreatment, list[Account]] = {}
        for acc in self.accounts:
            result.setdefault(acc.tax_treatment, []).append(acc)
        return result

    @property
    def total_cash(self) -> float:
        return sum(
            a.balance for a in self.accounts
            if a.tax_treatment == AccountTaxTreatment.CASH
        )

    @property
    def excess_cash(self) -> float:
        return max(0, self.total_cash - self.target_emergency_fund)

    @property
    def accounts_with_capacity(self) -> list[Account]:
        """Accounts that still have room under their annual limit."""
        return [
            a for a in self.accounts
            if a.annual_contribution_limit is not None
            and a.ytd_contribution < a.annual_contribution_limit
        ]

    # ─── Persistence ───────────────────────────────────────────────────────

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a JSON-compatible dict."""
        import dataclasses
        def _convert(obj: Any) -> Any:
            if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
                return {k: _convert(v) for k, v in dataclasses.asdict(obj).items()}
            if isinstance(obj, Enum):
                return obj.value
            if isinstance(obj, list):
                return [_convert(i) for i in obj]
            if isinstance(obj, dict):
                return {k: _convert(v) for k, v in obj.items()}
            return obj
        return _convert(self)

    def save(self, path: str | Path = "profile.json") -> None:
        Path(path).write_text(json.dumps(self.to_dict(), indent=2))

    @classmethod
    def load(cls, path: str | Path = "profile.json") -> "FinancialProfile":
        """Load from JSON. Returns default profile if file doesn't exist."""
        p = Path(path)
        if not p.exists():
            return create_sample_profile()
        data = json.loads(p.read_text())
        return cls._from_dict(data)

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> "FinancialProfile":
        """Reconstruct profile from dict. Handles nested dataclasses."""
        return FinancialProfile(
            household=[Person(**p) for p in data.get("household", [])],
            income=[IncomeStream(**i) for i in data.get("income", [])],
            accounts=[
                Account(
                    **{k: v for k, v in a.items() if k != "holdings"},
                    holdings=[Holding(**h) for h in a.get("holdings", [])],
                )
                for a in data.get("accounts", [])
            ],
            goals=[Goal(**g) for g in data.get("goals", [])],
            risk_tolerance=RiskTolerance(data.get("risk_tolerance", "moderate")),
            liquidity_needs=[LiquidityRequirement(**l) for l in data.get("liquidity_needs", [])],
            tax=TaxSnapshot(**data.get("tax", {})),
            current_month=data.get("current_month", 6),
            current_year=data.get("current_year", 2025),
            monthly_history=[MonthlySnapshot(**m) for m in data.get("monthly_history", [])],
            total_annual_investable=data.get("total_annual_investable", 150000),
            target_emergency_fund=data.get("target_emergency_fund", 18000),
            extensions=data.get("extensions", {}),
        )


# ─── Sample Profile ────────────────────────────────────────────────────────────

def create_sample_profile() -> FinancialProfile:
    """Creates a realistic sample profile for development/testing."""
    return FinancialProfile(
        household=[
            Person(name="Alex", age=32, retirement_age=55, is_primary=True),
        ],
        income=[
            IncomeStream(source="salary", annual_amount=200000, employer="TechCorp"),
            IncomeStream(source="rsu", annual_amount=50000, employer="TechCorp", frequency="quarterly"),
        ],
        accounts=[
            # Tax-Free
            Account(
                id="roth-401k", name="Roth 401(k)", institution="Fidelity",
                tax_treatment=AccountTaxTreatment.TAX_FREE,
                balance=85000, annual_contribution_limit=23500,
                ytd_contribution=11500, target_allocation_pct=15.3,
                employer_match_pct=0.04, employer_match_limit=8000,
                holdings=[
                    Holding(ticker="VTI", shares=300, asset_class=AssetClass.US_EQUITY_LARGE, dividend_yield=1.3, turnover_rate=4.0, expense_ratio=0.03),
                    Holding(ticker="VXUS", shares=150, asset_class=AssetClass.INTL_EQUITY_DEVELOPED, dividend_yield=3.1, turnover_rate=5.0, expense_ratio=0.07),
                ],
            ),
            Account(
                id="roth-ira", name="Roth IRA", institution="Vanguard",
                tax_treatment=AccountTaxTreatment.TAX_FREE,
                balance=45000, annual_contribution_limit=7000,
                ytd_contribution=7000, target_allocation_pct=4.7,
                holdings=[
                    Holding(ticker="VGT", shares=80, asset_class=AssetClass.US_EQUITY_LARGE, dividend_yield=0.6, turnover_rate=8.0, expense_ratio=0.10),
                ],
            ),
            Account(
                id="hsa", name="HSA", institution="Fidelity",
                tax_treatment=AccountTaxTreatment.TAX_FREE,
                balance=12000, annual_contribution_limit=4300,
                ytd_contribution=2150, target_allocation_pct=2.8,
                holdings=[
                    Holding(ticker="VTI", shares=40, asset_class=AssetClass.US_EQUITY_LARGE, dividend_yield=1.3, turnover_rate=4.0, expense_ratio=0.03),
                ],
            ),
            # Tax-Deferred
            Account(
                id="trad-401k", name="Traditional 401(k)", institution="Fidelity",
                tax_treatment=AccountTaxTreatment.TAX_DEFERRED,
                balance=120000, annual_contribution_limit=23500,
                ytd_contribution=11500, target_allocation_pct=15.3,
                holdings=[
                    Holding(ticker="VBTLX", shares=800, asset_class=AssetClass.US_BONDS, dividend_yield=3.5, turnover_rate=50.0, expense_ratio=0.05),
                    Holding(ticker="VTIAX", shares=200, asset_class=AssetClass.INTL_EQUITY_DEVELOPED, dividend_yield=3.1, turnover_rate=5.0, expense_ratio=0.11),
                ],
            ),
            Account(
                id="trad-ira", name="Traditional IRA", institution="Vanguard",
                tax_treatment=AccountTaxTreatment.TAX_DEFERRED,
                balance=35000, annual_contribution_limit=7000,
                ytd_contribution=3500, target_allocation_pct=4.7,
                holdings=[
                    Holding(ticker="SCHZ", shares=400, asset_class=AssetClass.US_BONDS, dividend_yield=3.8, turnover_rate=40.0, expense_ratio=0.03),
                ],
            ),
            Account(
                id="457b", name="457(b)", institution="Nationwide",
                tax_treatment=AccountTaxTreatment.TAX_DEFERRED,
                balance=28000, annual_contribution_limit=23500,
                ytd_contribution=5000, target_allocation_pct=6.7,
                holdings=[
                    Holding(ticker="VBIRX", shares=300, asset_class=AssetClass.US_BONDS, dividend_yield=3.2, turnover_rate=35.0, expense_ratio=0.07),
                ],
            ),
            # Taxable
            Account(
                id="brokerage", name="Brokerage Account", institution="Schwab",
                tax_treatment=AccountTaxTreatment.TAXABLE,
                balance=95000, annual_contribution_limit=None,
                ytd_contribution=17500, target_allocation_pct=23.3,
                holdings=[
                    Holding(ticker="VTI", shares=200, asset_class=AssetClass.US_EQUITY_LARGE, dividend_yield=1.3, turnover_rate=4.0, expense_ratio=0.03, cost_basis_per_share=180.0),
                    Holding(ticker="AAPL", shares=100, asset_class=AssetClass.US_EQUITY_LARGE, dividend_yield=0.5, turnover_rate=0.0, expense_ratio=0.0, cost_basis_per_share=120.0),
                    Holding(ticker="VXUS", shares=100, asset_class=AssetClass.INTL_EQUITY_DEVELOPED, dividend_yield=3.1, turnover_rate=5.0, expense_ratio=0.07, cost_basis_per_share=55.0),
                ],
            ),
            Account(
                id="espp", name="ESPP", institution="TechCorp/Schwab",
                tax_treatment=AccountTaxTreatment.TAXABLE,
                balance=32000, annual_contribution_limit=25000,
                ytd_contribution=6000, target_allocation_pct=8.0,
                holdings=[
                    Holding(ticker="TECH", shares=150, asset_class=AssetClass.US_EQUITY_LARGE, dividend_yield=0.0, turnover_rate=0.0, expense_ratio=0.0, cost_basis_per_share=180.0),
                ],
            ),
            Account(
                id="crypto", name="Crypto", institution="Coinbase",
                tax_treatment=AccountTaxTreatment.TAXABLE,
                balance=8000, annual_contribution_limit=None,
                ytd_contribution=2500, target_allocation_pct=3.3,
                holdings=[
                    Holding(ticker="BTC", shares=0.08, asset_class=AssetClass.CRYPTO, dividend_yield=0.0, turnover_rate=0.0, expense_ratio=0.0, cost_basis_per_share=35000.0),
                ],
            ),
            # Cash
            Account(
                id="hysa", name="High-Yield Savings", institution="Marcus",
                tax_treatment=AccountTaxTreatment.CASH,
                balance=15000, annual_contribution_limit=None,
                ytd_contribution=15000, target_allocation_pct=10.0,
            ),
            Account(
                id="checking", name="Checking", institution="Chase",
                tax_treatment=AccountTaxTreatment.CASH,
                balance=5000, annual_contribution_limit=None,
                ytd_contribution=5000, target_allocation_pct=3.3,
            ),
            Account(
                id="money-market", name="Money Market", institution="Vanguard",
                tax_treatment=AccountTaxTreatment.CASH,
                balance=3850, annual_contribution_limit=None,
                ytd_contribution=3850, target_allocation_pct=2.6,
            ),
        ],
        goals=[
            Goal(name="Early Retirement", target_amount=2500000, target_date="2048-01-01", priority=1, current_progress=484850),
            Goal(name="House Down Payment", target_amount=200000, target_date="2027-06-01", priority=2, current_progress=60000, monthly_contribution=5000),
        ],
        risk_tolerance=RiskTolerance.AGGRESSIVE,
        liquidity_needs=[
            LiquidityRequirement(purpose="emergency_fund", amount=18000, timeframe_months=0),
            LiquidityRequirement(purpose="house_down_payment", amount=200000, timeframe_months=24),
        ],
        tax=TaxSnapshot(
            filing_status=FilingStatus.SINGLE,
            state="CA",
            estimated_agi=250000,
            marginal_federal_rate=0.32,
            marginal_state_rate=0.093,
            long_term_cap_gains_rate=0.15,
            net_investment_income_tax=0.038,
        ),
        current_month=6,
        current_year=2025,
        monthly_history=[
            MonthlySnapshot(month="2025-01", tax_free=5600, tax_deferred=6200, taxable=7500, cash=4200),
            MonthlySnapshot(month="2025-02", tax_free=5600, tax_deferred=6200, taxable=8000, cash=3000),
            MonthlySnapshot(month="2025-03", tax_free=5800, tax_deferred=6500, taxable=8500, cash=2800),
            MonthlySnapshot(month="2025-04", tax_free=5500, tax_deferred=6800, taxable=9000, cash=3200),
            MonthlySnapshot(month="2025-05", tax_free=5700, tax_deferred=7000, taxable=9500, cash=2500),
            MonthlySnapshot(month="2025-06", tax_free=5950, tax_deferred=7300, taxable=9500, cash=2650),
        ],
        total_annual_investable=150000,
        target_emergency_fund=18000,
    )
