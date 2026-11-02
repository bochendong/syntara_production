/**
 * A small stand-in for UBC CPSC 103's `cs103` library, registered as an in-memory module
 * in every Python runtime (server judge, browser runs, native Run) before student code.
 *
 * Provides `@typecheck` (runtime checks of argument and return annotations), the
 * `start_testing` / `expect` / `summary` test helpers, and `parse_int` / `parse_float`.
 * Image functions are not provided.
 */
export const CS103_PYTHON_SOURCE = String.raw`
import enum as _enum
import functools as _functools
import inspect as _inspect
import math as _math
import typing as _typing

__all__ = ["typecheck", "start_testing", "expect", "summary", "parse_int", "parse_float"]

_results = []


def _type_name(tp):
    if tp is None or tp is type(None):
        return "None"
    origin = _typing.get_origin(tp)
    if origin is not None:
        args = ", ".join(_type_name(a) for a in _typing.get_args(tp))
        name = getattr(origin, "__name__", None) or str(origin).replace("typing.", "")
        if origin is _typing.Union:
            parts = [a for a in _typing.get_args(tp)]
            if len(parts) == 2 and type(None) in parts:
                return "Optional[" + _type_name([p for p in parts if p is not type(None)][0]) + "]"
            return "Union[" + args + "]"
        return name + "[" + args + "]"
    return getattr(tp, "__name__", str(tp))


def _matches(value, tp):
    if tp is _typing.Any or tp is Ellipsis or tp is _inspect.Parameter.empty:
        return True
    if tp is None or tp is type(None):
        return value is None
    if tp is float:
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if tp is int:
        return isinstance(value, int) and not isinstance(value, bool)
    origin = _typing.get_origin(tp)
    args = _typing.get_args(tp)
    if origin is _typing.Union:
        return any(_matches(value, a) for a in args)
    if origin in (list, _typing.List):
        return isinstance(value, list) and (not args or all(_matches(v, args[0]) for v in value))
    if origin in (tuple, _typing.Tuple):
        if not isinstance(value, tuple):
            return False
        if not args or (len(args) == 2 and args[1] is Ellipsis):
            return not args or all(_matches(v, args[0]) for v in value)
        return len(args) == len(value) and all(_matches(v, a) for v, a in zip(value, args))
    if origin in (dict, _typing.Dict):
        return isinstance(value, dict) and (not args or all(
            _matches(k, args[0]) and _matches(v, args[1]) for k, v in value.items()))
    if origin is not None:
        return isinstance(value, origin)
    if isinstance(tp, type) and issubclass(tp, tuple) and hasattr(tp, "_fields"):
        if not isinstance(value, tp):
            return False
        try:
            hints = _typing.get_type_hints(tp)
        except Exception:
            hints = getattr(tp, "__annotations__", {})
        return all(_matches(getattr(value, f), hints[f]) for f in tp._fields if f in hints)
    if isinstance(tp, type):
        return isinstance(value, tp)
    return True


def typecheck(fn):
    """Check every call's arguments and return value against fn's annotations."""
    signature = _inspect.signature(fn)

    @_functools.wraps(fn)
    def checked(*args, **kwargs):
        try:
            hints = _typing.get_type_hints(fn)
        except Exception:
            hints = dict(fn.__annotations__)
        bound = signature.bind(*args, **kwargs)
        for name, value in bound.arguments.items():
            if name in hints and not _matches(value, hints[name]):
                raise TypeError(
                    "%s: argument %s should be %s, but got %r (%s)"
                    % (fn.__name__, name, _type_name(hints[name]), value, type(value).__name__))
        result = fn(*args, **kwargs)
        if "return" in hints and not _matches(result, hints["return"]):
            raise TypeError(
                "%s: should return %s, but returned %r (%s)"
                % (fn.__name__, _type_name(hints["return"]), result, type(result).__name__))
        return result

    return checked


def _same(actual, expected):
    """Equality used by expect and by hidden tests: floats compare approximately."""
    if isinstance(actual, bool) or isinstance(expected, bool):
        return actual == expected and type(actual) is type(expected)
    if isinstance(actual, (int, float)) and isinstance(expected, (int, float)):
        return _math.isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-9)
    if isinstance(actual, tuple) and isinstance(expected, tuple):
        if type(actual) is not type(expected) and hasattr(expected, "_fields"):
            return False
        return len(actual) == len(expected) and all(_same(a, b) for a, b in zip(actual, expected))
    if isinstance(actual, list) and isinstance(expected, list):
        return len(actual) == len(expected) and all(_same(a, b) for a, b in zip(actual, expected))
    return actual == expected


def start_testing():
    """Begin a group of tests; earlier results are discarded."""
    _results.clear()


def expect(actual, expected):
    """Record one test: the actual value should equal the expected value."""
    caller = _inspect.stack()[1]
    passed = _same(actual, expected)
    _results.append({"passed": passed, "actual": actual, "expected": expected, "line": caller.lineno})
    return passed


def summary():
    """Print how many tests passed, and each failure."""
    total = len(_results)
    passed = sum(1 for r in _results if r["passed"])
    if total == 0:
        print("No tests were run.")
    elif passed == total:
        print("%d of %d tests passed" % (passed, total))
    else:
        print("%d of %d tests passed" % (passed, total))
        for index, r in enumerate(_results, 1):
            if not r["passed"]:
                print("  Test %d (line %d) failed: got %r but expected %r"
                      % (index, r["line"], r["actual"], r["expected"]))


def parse_int(s):
    """Convert a CSV field to an int."""
    return int(str(s).strip())


def parse_float(s):
    """Convert a CSV field to a float."""
    return float(str(s).strip())
`.trim();

/** True when Python code is written against UBC CPSC 103's cs103 library. */
export function usesCs103(source: string | undefined): boolean {
  return /^\s*(?:from\s+cs103\s+import|import\s+cs103\b|@typecheck\b)/m.test(source ?? '');
}

/** Python statement that installs CS103_PYTHON_SOURCE (bound to `source_name`) as `cs103`. */
export function cs103BootstrapPython(sourceName: string): string {
  return [
    'import sys as _sys, types as _types',
    '_cs103 = _types.ModuleType("cs103")',
    `exec(${sourceName}, _cs103.__dict__)`,
    '_sys.modules["cs103"] = _cs103',
    'del _cs103',
  ].join('\n');
}
