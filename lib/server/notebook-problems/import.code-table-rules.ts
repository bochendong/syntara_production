/**
 * 导入 AI 的补充规则：代码空位、挂文件 / input() 题、表格题。
 * 拼进各个导入提示词里，和 multipart 规则放在一起。
 */

export const CODE_TABLE_RULES_ZH = `- 代码空位（docstring 题和代码里的填空都用 code 题型，不要用 fill_blank）：
  - 「按 docstring 完成函数」：publicContent.template = 必要 imports + 函数头 + 完整 docstring + 单独一行的 {{body}}（缩进与函数体一致），slots=[{"id":"body","kind":"block"}]；grading.solutionSlots={"body":"参考函数体，不带外层缩进"}。
  - 代码里的「Fill in the box(es)」：把原代码原样写进 template，每个框换成 {{slot_id}}；行内的框 kind="expr"，占一整行的框 kind="line"，多行的框 kind="block"（独占一行）。slot_id 用英文小写，如 cond、init、range_args；可加 placeholder 或 hint（如「用 is_canadian_flight」）。grading.solutionSlots 给每个框的参考答案。
  - 两个空位不能紧挨着；template 以外的代码学生改不了。starterCode 写成空位全空时的代码（block 空位写 pass）。
  - 判分靠 publicTestCode / secretTestCode 测试拼好的整段代码，所以空位的不同正确写法都算对；测试照常 from submission import 函数名。
- 读写文件、input() 的题保留原样，不要改写成纯函数：
  - 题目给的文件放进 publicContent.files=[{"path":"data.csv","content":"...","format":"csv","role":"input","visible":true}]；原题没给内容就按题意造一份不超过 20 行的小样例，并在 sourceMeta.adaptation.changes 记一笔。只给隐藏测试用的文件放 secretJudge.files。
  - 运行时工作目录里就有这些文件：测试里可以 open('data.csv') 再传给函数，也可以先写一份内容不同的文件，或用 io.StringIO 构造 TextIO 再调用。
  - 程序要写文件时，可以给 role="expected_output" 的文件展示写完后的样子，测试里读回文件检查。
  - 需要 input() 时给 publicContent.stdin 作示例输入；测试里用 unittest.mock.patch('builtins.input', ...) 或替换 sys.stdin。
- 表格题 type="table"：「Beside each code fragment in the table, write what is printed」、表达式求值/类型表、循环逐轮追踪表、补 docstring 例子的返回值或参数。不要再写成 markdown 表格 + fill_blank。
  - publicContent={type:"table", responseKind:"table_cells", stem:"表格上方的说明", setupCode?:"表格上方先运行的共享代码", columns:[{id, header, role:"given"|"answer", cellKind:"code"|"text"|"python_value"|"output"}], rows:[{id, cells:{给定列 id: 内容}}], quickAnswers?:["ERROR","NOTHING"], runnable:true（每行给定代码能单独运行时）}。作答列在 rows 里不写。最多 40 行、8 列；id 只用字母数字和下划线。
  - grading={type:"table", graderKind:"table_match", cells:[{rowId, colId, acceptedAnswers:[...], matcher}]}，每个作答格一项。打印输出用 matcher="output"（多行按原样换行；报错写 "ERROR"；没有输出写 "NOTHING"）；表达式的值用 "python_value"（Python 字面量，如 'abc'、[1, 2]、True）；答案不唯一时（补参数使返回 3、给一个让函数出错的输入）用 "run_check"，check 是含 {answer} 的 Python 表达式，如 "midterm_function('badger', {answer}) == 3"，可调用 setupCode 里定义的函数；纯文字用 "normalized_exact"。
  - 平台会真跑每行代码核对 output 和 python_value 答案，和你写的不一致时以运行结果为准并提醒老师，所以答案必须按 Python 3 的实际行为写。`;

export const CODE_TABLE_RULES_EN = `- Code slots (docstring tasks and blanks inside code both use type=code, never fill_blank):
  - "Complete the function according to its docstring": publicContent.template = needed imports + header + the full docstring + {{body}} alone on its own line (indented like the body), slots=[{"id":"body","kind":"block"}]; grading.solutionSlots={"body":"reference body without the outer indentation"}.
  - "Fill in the box(es)" inside code: copy the source code into template verbatim and replace each box with {{slot_id}}; inline boxes kind="expr", whole-line boxes kind="line", multi-line boxes kind="block" (alone on its line). Use short lowercase ids such as cond, init, range_args; optional placeholder or hint (e.g. "use is_canadian_flight"). grading.solutionSlots holds each box's reference answer.
  - Two slots must never touch; code outside the slots is read-only for students. starterCode is the code with every slot empty (block slots become pass).
  - Grading still runs publicTestCode / secretTestCode on the assembled module, so any correct way of filling a slot passes; tests still use from submission import the_function.
- Keep file-reading/writing and input() tasks as they are; do not rewrite them into pure functions:
  - Put provided files in publicContent.files=[{"path":"data.csv","content":"...","format":"csv","role":"input","visible":true}]; when the source shows no contents, invent a small sample (at most 20 lines) that fits the task and note it in sourceMeta.adaptation.changes. Files used only by secret tests go in secretJudge.files.
  - The files exist in the working directory at run time: tests may open('data.csv') and pass the handle, write a different file first, or build a TextIO with io.StringIO.
  - For programs that write files, an optional role="expected_output" file shows the expected result; tests read the file back to check it.
  - For input(), give sample input in publicContent.stdin; tests use unittest.mock.patch('builtins.input', ...) or replace sys.stdin.
- Table problems type="table": "Beside each code fragment in the table, write what is printed", expression value/type tables, loop trace tables, completing docstring example return values or arguments. Never encode these as a markdown table plus fill_blank.
  - publicContent={type:"table", responseKind:"table_cells", stem:"instructions above the table", setupCode?:"shared code run before every row", columns:[{id, header, role:"given"|"answer", cellKind:"code"|"text"|"python_value"|"output"}], rows:[{id, cells:{given column id: content}}], quickAnswers?:["ERROR","NOTHING"], runnable:true (when each row's code runs on its own)}. Leave answer columns out of rows. At most 40 rows and 8 columns; ids use letters, digits and underscores.
  - grading={type:"table", graderKind:"table_match", cells:[{rowId, colId, acceptedAnswers:[...], matcher}]}, one entry per answer cell. Printed output uses matcher="output" (keep line breaks; an error is "ERROR"; no output is "NOTHING"); expression values use "python_value" (Python literals such as 'abc', [1, 2], True); when many answers are right (arguments that make it return 3, an input that breaks the function) use "run_check" with check = a Python expression containing {answer}, e.g. "midterm_function('badger', {answer}) == 3", which may call functions defined in setupCode; plain words use "normalized_exact".
  - The platform executes every row to verify output and python_value answers and keeps the executed result when yours differs (flagging it for the teacher), so answers must follow real Python 3 behavior.`;
