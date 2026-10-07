"""Isolated clingo worker; only the compiler's generated program enters here.

Running grounding and solving in a child process lets the parent enforce a wall
clock deadline even while clingo's grounder is busy. No shell is involved.
"""

from multiprocessing.connection import Connection


def enumerate_program(connection: Connection, program: str, max_models: int) -> None:
    """Return at most one extra model, to distinguish a cap from exhaustion."""
    try:
        import clingo

        control = clingo.Control(["0", "--seed=0", "--parallel-mode=1", "--warn=none"])
        control.add("base", [], program)
        control.ground([("base", [])])
        model_count = 0

        def on_model(model: clingo.Model) -> bool:
            nonlocal model_count
            result: dict[str, list[int]] = {
                "holds": [],
                "applied": [],
                "defeated": [],
                "applicable": [],
            }
            for symbol in model.symbols(shown=True):
                if symbol.name in result:
                    result[symbol.name].append(symbol.arguments[0].number)
            connection.send({"model": {key: sorted(values) for key, values in result.items()}})
            model_count += 1
            return model_count <= max_models

        result = control.solve(on_model=on_model)
        connection.send({"complete": result.exhausted})
    except Exception as exc:
        connection.send({"error": f"{type(exc).__name__}: {exc}"})
    finally:
        connection.close()
