/**
 * Design-recipe checks for UBC CPSC 103 (Python + cs103) submissions, the Python counterpart
 * of RACKET_RECIPE_DRIVER. Expected answers come from the reference solution: every function
 * and data definition the reference designs, and the starter doesn't already give, is
 * compared with the student's file using Python's ast module.
 *
 * HtDF: signature (parameter and return annotations, names ignored), @typecheck, a purpose
 * docstring, the commented-out stub, the `# template based on ...` comment and template, and
 * the student's own expect() calls (correct per the reference function, thorough per the
 * problem's predicates). HtDD: the NamedTuple / Enum / alias definition, an `interp.` comment,
 * at least one example, and the fn_for_... template.
 *
 * Runs as the Python runner script: argv[1] is the JSON payload, codePath the student's file.
 */
export const PYTHON_RECIPE_DRIVER = String.raw`
import ast, contextlib, io, json, re, sys, types

payload = json.loads(sys.argv[1])
student_text = open(payload["codePath"], encoding="utf-8").read()
reference_text = payload["referenceText"]
starter_text = payload.get("starterText") or ""
check_template = payload.get("checkTemplate")
thoroughness = payload.get("thoroughness") or []
items = []


def item(check_id, target, passed, detail=None):
    entry = {"id": check_id, "target": target, "passed": bool(passed)}
    if detail and not passed:
        entry["detail"] = detail[:2000]
    items.append(entry)


def emit():
    sys.__stdout__.write(json.dumps({"items": items}, ensure_ascii=False) + "\n")


def parse(text):
    try:
        return ast.parse(text)
    except SyntaxError as exc:
        return exc


def show(text, limit=200):
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 3] + "..."


def norm_type(node):
    """Annotation text with List/Dict/Tuple spelled like the builtins and spaces removed."""
    if node is None:
        return None
    text = ast.unparse(node) if not isinstance(node, str) else node
    text = re.sub(r"\s+", "", text).strip("'\"")
    text = re.sub(r"\b(?:typing\.)?(List|Dict|Tuple|Set)\[", lambda m: m.group(1).lower() + "[", text)
    return text


def functions(tree):
    return {n.name: n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}


def body_without_docstring(fn):
    body = list(fn.body)
    if body and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], "value", None), ast.Constant) \
            and isinstance(body[0].value.value, str):
        body = body[1:]
    return body


def same_body(a, b):
    dump = lambda fn: [ast.dump(s) for s in body_without_docstring(fn)]
    return dump(a) == dump(b)


def source_lines(text, node):
    lines = text.splitlines()
    end = getattr(node, "end_lineno", node.lineno)
    return lines[node.lineno - 1 : end]


def comments(text, node):
    return [line.strip() for line in source_lines(text, node) if line.strip().startswith("#")]


def signature_text(fn):
    params = ", ".join(norm_type(a.annotation) or "?" for a in fn.args.args)
    return "(%s) -> %s" % (params, norm_type(fn.returns) or "?")


def has_typecheck(fn):
    return any((isinstance(d, ast.Name) and d.id == "typecheck") or
               (isinstance(d, ast.Attribute) and d.attr == "typecheck") for d in fn.decorator_list)


TEMPLATE_RE = re.compile(r"#.*\btemplate\s+(?:based\s+on|from)\s+(.+)$", re.I)


def template_origins(lines):
    found = []
    for line in lines:
        match = TEMPLATE_RE.search(line)
        if match:
            # "compound (4 fields) and reference rule; limit is an extra parameter" -> parts
            origin = re.sub(r"\([^)]*\)", "", match.group(1).split(";")[0].lower())
            parts = re.split(r",|\band\b|\bwith\b|\+", origin)
            found.append(sorted(p.strip(" .") for p in parts if p.strip(" .")))
    return found


def covers_origin(mine, expected):
    """Every part of the expected origin is named; extra parts (an added parameter) are fine."""
    return bool(mine) and all(any(e in m or m in e for m in mine[0]) for e in expected[0])


def is_stub_comment(line):
    return bool(re.match(r"#\s*return\b.*#\s*stub\b", line, re.I))


def template_shape(fn):
    """ast.dump of a template with parameters and local variables renamed by position."""
    mapping = {arg.arg: "p%d" % i for i, arg in enumerate(fn.args.args)}
    for node in ast.walk(fn):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store) and node.id not in mapping:
            mapping[node.id] = "v%d" % len(mapping)

    class Rename(ast.NodeTransformer):
        def visit_Name(self, node):
            # Called template functions keep their names (lowercased): fn_for_loan_state(...).
            name = mapping.get(node.id, node.id.lower() if node.id.startswith("fn_for_") else node.id)
            return ast.copy_location(ast.Name(id=name, ctx=node.ctx), node)

        def visit_arg(self, node):
            return ast.arg(arg=mapping.get(node.arg, node.arg))

        def visit_Call(self, node):
            self.generic_visit(node)
            # ...(a, b): the order of the arguments to the ... placeholder does not matter.
            if isinstance(node.func, ast.Constant) and node.func.value is Ellipsis:
                node.args = sorted(node.args, key=ast.dump)
            return node

    body = [Rename().visit(ast.parse(ast.unparse(s)).body[0]) for s in body_without_docstring(fn)]
    for s in body:
        ast.fix_missing_locations(s)
    return [ast.dump(s) for s in body]


def commented_template(text, fn):
    """The template code a student kept as comments ('# return ...(n)'), parsed back."""
    code = []
    for line in comments(text, fn):
        stripped = line.lstrip("#").strip()
        if "..." in stripped and not is_stub_comment(line):
            code.append(stripped.split("#")[0].strip())
    return code


# ---------------------------------------------------------------------------
# Data definitions: NamedTuple, Enum, and aliases such as Optional[...] / list[...].

def data_definitions(tree):
    found = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name, value = node.targets[0].id, node.value
            if isinstance(value, ast.Call) and getattr(value.func, "id", getattr(value.func, "attr", "")) == "NamedTuple":
                fields = []
                if len(value.args) > 1 and isinstance(value.args[1], (ast.List, ast.Tuple)):
                    for elt in value.args[1].elts:
                        if isinstance(elt, ast.Tuple) and len(elt.elts) == 2:
                            fields.append((ast.literal_eval(elt.elts[0]), norm_type(elt.elts[1])))
                found[name] = ("namedtuple", fields, node)
            elif isinstance(value, ast.Call) and getattr(value.func, "id", getattr(value.func, "attr", "")) == "Enum":
                members = []
                if len(value.args) > 1:
                    try:
                        raw = ast.literal_eval(value.args[1])
                        members = raw.split() if isinstance(raw, str) else list(raw)
                    except Exception:
                        pass
                found[name] = ("enum", sorted(str(m).lower() for m in members), node)
            elif isinstance(value, (ast.Subscript, ast.Name)) and name[:1].isupper() and \
                    norm_type(value).split("[")[0] in ("Optional", "Union", "list", "List", "int", "float", "str", "bool"):
                found[name] = ("alias", norm_type(value), node)
        elif isinstance(node, ast.ClassDef):
            bases = [getattr(b, "id", getattr(b, "attr", "")) for b in node.bases]
            if "NamedTuple" in bases:
                fields = [(s.target.id, norm_type(s.annotation)) for s in node.body
                          if isinstance(s, ast.AnnAssign) and isinstance(s.target, ast.Name)]
                found[node.name] = ("namedtuple", fields, node)
            elif "Enum" in bases:
                members = [t.id.lower() for s in node.body if isinstance(s, ast.Assign)
                           for t in s.targets if isinstance(t, ast.Name)]
                found[node.name] = ("enum", sorted(members), node)
    return found


def section_text(text, tree, node):
    """Source from a definition up to the next function/class/data definition."""
    starts = sorted(n.lineno for n in tree.body if n.lineno > node.lineno and
                    isinstance(n, (ast.FunctionDef, ast.ClassDef)))
    lines = text.splitlines()
    end = (starts[0] - 1) if starts else len(lines)
    return "\n".join(lines[node.lineno - 1 : end])


def describe_dd(kind, shape):
    if kind == "namedtuple":
        return "NamedTuple with fields (%s)" % ", ".join("%s: %s" % f for f in shape)
    if kind == "enum":
        return "Enum with members %s" % ", ".join(shape)
    return shape


# ---------------------------------------------------------------------------
# Tests: the student's expect() calls, evaluated against the reference.

def expects(tree):
    calls = []
    for node in tree.body:
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) and \
                getattr(node.value.func, "id", None) == "expect" and len(node.value.args) == 2:
            calls.append(node.value)
    return calls


def mentions(node, name):
    return any(isinstance(n, ast.Name) and n.id == name for n in ast.walk(node))


_reference_ns = None


def reference_namespace(student_tree, reference_names):
    global _reference_ns
    if _reference_ns is None:
        if payload.get("cs103Source"):
            module = types.ModuleType("cs103")
            exec(payload["cs103Source"], module.__dict__)
            sys.modules["cs103"] = module
        ns = {"__name__": "reference"}
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                exec(compile(reference_text, "reference.py", "exec"), ns)
        except BaseException as exc:
            _reference_ns = "%s: %s" % (type(exc).__name__, exc)
            return _reference_ns
        # Data examples only the student wrote (e.g. V3 = Velocity(...)) are available to tests.
        for node in student_tree.body:
            if isinstance(node, ast.Assign) and all(isinstance(t, ast.Name) and t.id not in reference_names
                                                    for t in node.targets):
                try:
                    with contextlib.redirect_stdout(io.StringIO()):
                        exec(compile(ast.Module(body=[node], type_ignores=[]), "student.py", "exec"), ns)
                except BaseException:
                    pass
        _reference_ns = ns
    return _reference_ns


def main():
    student = parse(student_text)
    reference = parse(reference_text)
    starter = parse(starter_text) if starter_text.strip() else ast.Module(body=[], type_ignores=[])
    if isinstance(reference, SyntaxError) or isinstance(starter, SyntaxError):
        item("read", "", False, "the reference solution or starter does not parse")
        return
    if isinstance(student, SyntaxError):
        item("read", "", False, "line %s: %s" % (student.lineno, student.msg))
        return

    ref_fns, stu_fns, start_fns = functions(reference), functions(student), functions(starter)
    ref_dds, stu_dds, start_dds = data_definitions(reference), data_definitions(student), data_definitions(starter)
    reference_names = {t.id for n in reference.body if isinstance(n, ast.Assign) for t in n.targets
                       if isinstance(t, ast.Name)} | set(ref_fns)
    template_names = [n for n in ref_fns if n.startswith("fn_for_")]

    # HtDD -----------------------------------------------------------------
    for name, (kind, shape, node) in ref_dds.items():
        given = start_dds.get(name)
        if given and given[:2] == (kind, shape):
            continue
        mine = stu_dds.get(name)
        if not mine:
            item("data_definition", name, False, "missing the data definition for %s" % name)
            continue
        same = mine[0] == kind and (
            [t for _, t in mine[1]] == [t for _, t in shape] if kind == "namedtuple" else mine[1] == shape)
        item("data_definition", name, same,
             "%s should be a %s, but yours is a %s" % (name, describe_dd(kind, shape), describe_dd(*mine[:2])))
        ref_section = section_text(reference_text, reference, node)
        stu_section = section_text(student_text, student, mine[2])
        if re.search(r"#\s*interp", ref_section, re.I):
            item("data_definition", name, re.search(r"#\s*interp", stu_section, re.I),
                 "add an '# interp.' comment explaining what %s represents" % name)
        if kind in ("namedtuple", "alias") and re.search(r"^[A-Z0-9_]+\s*=", ref_section, re.M):
            example = re.compile(r"^[A-Za-z_]\w*\s*=\s*(?:%s\s*\(|\[|None\b|-?\d|['\"])" % re.escape(name), re.M)
            item("data_definition", name, example.search(stu_section),
                 "write at least one example of %s" % name)

    # HtDF -----------------------------------------------------------------
    for name, fn in ref_fns.items():
        given = start_fns.get(name)
        if given and same_body(given, fn):
            continue
        mine = stu_fns.get(name)
        is_template_fn = name in template_names
        if not mine:
            if not is_template_fn:
                item("signature", name, False, "missing the function %s" % name)
                continue
            # A student may name the template function differently (fn_for_x vs fn_for_X).
            candidates = [f for n, f in stu_fns.items() if n.lower() == name.lower()]
            if not candidates:
                if check_template is not False:
                    item("template", name, False, "missing the template function %s" % name)
                continue
            mine = candidates[0]

        if not is_template_fn:
            expected_sig, actual_sig = signature_text(fn), signature_text(mine)
            if not (given and signature_text(given) == expected_sig):
                item("signature", name, expected_sig == actual_sig and len(fn.args.args) == len(mine.args.args),
                     "your signature %s does not match the problem" % actual_sig)
                if has_typecheck(fn):
                    item("typecheck", name, has_typecheck(mine), "add @typecheck above def %s" % name)
            if ast.get_docstring(fn) and not (given and ast.get_docstring(given)):
                doc = (ast.get_docstring(mine) or "").strip()
                item("purpose", name, len(doc) >= 3, "write a purpose docstring for %s" % name)
            if any(is_stub_comment(c) for c in comments(reference_text, fn)) and \
                    not (given and any(is_stub_comment(c) for c in comments(starter_text, given))):
                item("stub", name, any(is_stub_comment(c) for c in comments(student_text, mine)),
                     "keep the stub as a comment, e.g. '# return 0  # stub'")

        ref_origins = template_origins(comments(reference_text, fn))
        given_origins = template_origins(comments(starter_text, given)) if given else []
        compare_template = check_template if check_template is not None else bool(ref_origins and not given_origins)
        if compare_template and ref_origins:
            mine_origins = template_origins(comments(student_text, mine))
            item("template_origin", name, covers_origin(mine_origins, ref_origins),
                 "missing '# template based on ...'" if not mine_origins else
                 "your template is based on %s, but %s's should be based on %s"
                 % (", ".join(mine_origins[0]), name, ", ".join(ref_origins[0])))
            ref_code = commented_template(reference_text, fn)
            if is_template_fn:
                expected_shape = template_shape(fn)
                actual_shape = template_shape(mine)
                item("template", name, expected_shape == actual_shape,
                     "your template does not match the data definition: expected the shape of\n%s"
                     % "\n".join(ast.unparse(s) for s in body_without_docstring(fn)))
            elif ref_code:
                mine_code = commented_template(student_text, mine)
                item("template", name, bool(mine_code),
                     "keep the template as comments, e.g. '# %s'" % show(ref_code[0], 80))

        if is_template_fn:
            continue
        ref_tests = [e for e in expects(reference) if mentions(e.args[0], name)]
        given_tests = {ast.dump(e) for e in expects(starter)}
        if not ref_tests or all(ast.dump(e) in given_tests for e in ref_tests):
            continue
        own = [e for e in expects(student) if mentions(e.args[0], name) and ast.dump(e) not in given_tests]
        if not own:
            item("test_validity", name, False, "write expect(...) tests for %s" % name)
            continue
        ns = reference_namespace(student, reference_names)
        if isinstance(ns, str):
            item("test_validity", name, False, "reference solution failed to load: " + ns)
            continue
        same = sys.modules["cs103"]._same if "cs103" in sys.modules else (lambda a, b: a == b)
        bad = []
        for call in own:
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    actual = eval(compile(ast.Expression(call.args[0]), "test", "eval"), ns)
                    expected = eval(compile(ast.Expression(call.args[1]), "test", "eval"), ns)
                if not same(actual, expected):
                    bad.append(call)
            except BaseException:
                bad.append(call)
        item("test_validity", name, not bad,
             "%d of %d test(s) disagree with a correct %s: %s"
             % (len(bad), len(own), name, " ".join(show(ast.unparse(c), 120) for c in bad[:3])))
        wanted = [t for t in thoroughness if t.get("target") == name]
        if wanted:
            params = [a.arg for a in fn.args.args]
            arg_lists = []
            for call in own:
                for node in ast.walk(call.args[0]):
                    if isinstance(node, ast.Call) and getattr(node.func, "id", None) == name and \
                            len(node.args) == len(params):
                        try:
                            with contextlib.redirect_stdout(io.StringIO()):
                                arg_lists.append([eval(compile(ast.Expression(a), "arg", "eval"), ns)
                                                  for a in node.args])
                        except BaseException:
                            pass
            uncovered = []
            for t in wanted:
                covered = False
                for args in arg_lists:
                    try:
                        # One namespace: generator expressions in a predicate can't see eval locals.
                        if eval(t["predicate"], {**ns, **dict(zip(params, args))}):
                            covered = True
                            break
                    except BaseException:
                        pass
                if not covered:
                    uncovered.append(t["description"])
            item("test_thoroughness", name, not uncovered, "no test covers: " + "; ".join(uncovered))


try:
    with contextlib.redirect_stdout(io.StringIO()):
        main()
except BaseException as exc:
    item("read", "", False, "design recipe check failed: %s: %s" % (type(exc).__name__, exc))
emit()
`.trim();
