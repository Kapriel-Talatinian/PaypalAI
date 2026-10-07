from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DISPUTEFLOW_", env_file=".env", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    database_url: str = "sqlite:///./disputeflow.db"
    api_key: SecretStr = SecretStr("local-development-key-change-me")
    reviewer_api_key: SecretStr | None = None
    policy_dir: Path = Path("policies")
    llm_provider: Literal["demo", "openai"] = "demo"
    openai_api_key: SecretStr | None = None
    openai_model: str = "gpt-4.1-mini"
    openai_base_url: str = "https://api.openai.com/v1"
    llm_timeout_seconds: float = Field(default=45, ge=1, le=180)
    retrieval_max_clauses: int = Field(default=16, ge=1, le=100)
    max_repair_attempts: int = Field(default=2, ge=0, le=5)
    solver_max_models: int = Field(default=64, ge=2, le=4096)
    solver_timeout_seconds: float = Field(default=5, ge=0.1, le=60)
    analysis_timeout_seconds: float = Field(default=180, ge=10, le=600)
    execution_timeout_seconds: float = Field(default=90, ge=10, le=300)
    auto_confidence_threshold: float = Field(default=0.95, ge=0, le=1)
    auto_max_amount: float = Field(default=100, ge=0)
    auto_currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    execution_mode: Literal["dry_run", "sandbox", "live"] = "dry_run"
    paypal_environment: Literal["sandbox", "live"] = "sandbox"
    paypal_client_id: str = ""
    paypal_client_secret: SecretStr | None = None
    paypal_webhook_id: str = ""
    paypal_timeout_seconds: float = Field(default=20, ge=1, le=60)
    webhook_policy_id: str = "demo_policy"
    worker_poll_seconds: float = Field(default=1, ge=0.1, le=60)
    job_lease_seconds: int = Field(default=900, ge=300, le=3600)
    cors_origins: list[str] = Field(default_factory=list)

    @field_validator("database_url")
    @classmethod
    def use_psycopg(cls, value: str) -> str:
        # Render and other providers commonly supply these URL schemes.
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix) :]
        return value

    @model_validator(mode="after")
    def coherent(self) -> "Settings":
        if self.execution_mode != "dry_run" and self.execution_mode != self.paypal_environment:
            raise ValueError("Execution mode must match PayPal environment")
        if self.llm_provider == "openai" and not self.openai_api_key:
            raise ValueError("OpenAI extraction requires DISPUTEFLOW_OPENAI_API_KEY")
        if self.environment == "production":
            if (
                len(self.api_key.get_secret_value()) < 32
                or self.api_key.get_secret_value() == "local-development-key-change-me"
            ):
                raise ValueError("Production requires a unique API key of at least 32 characters")
            if not self.reviewer_api_key or len(self.reviewer_api_key.get_secret_value()) < 32:
                raise ValueError(
                    "Production requires a separate reviewer API key of at least 32 characters"
                )
            if self.reviewer_api_key.get_secret_value() == self.api_key.get_secret_value():
                raise ValueError("Production reviewer and service keys must differ")
        if self.execution_mode != "dry_run" and (
            not self.paypal_client_id or not self.paypal_client_secret
        ):
            raise ValueError("PayPal execution requires client credentials")
        if self.job_lease_seconds <= self.analysis_timeout_seconds + 60:
            raise ValueError(
                "Job lease must exceed the total analysis deadline by at least 60 seconds"
            )
        return self
