"""Deterministic, bounded ASP reasoning over validated extracted knowledge."""

from .solver import SolverError, compile_program, solve

__all__ = ["SolverError", "compile_program", "solve"]
