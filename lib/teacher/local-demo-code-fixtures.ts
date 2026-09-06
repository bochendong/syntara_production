export const LOCAL_DEMO_CODE_FIXTURES = [
  {
    slug: 'class-stack',
    title: '实现 Stack 类',
    stem: '实现 `Stack` 类：`push(value)` 入栈，`pop()` 返回并移除栈顶，`len(stack)` 返回元素数。空栈 `pop()` 抛出 `IndexError`；不同实例之间状态独立。',
    starterCode:
      'class Stack:\n    """Implement a last-in, first-out stack."""\n    def __init__(self):\n        pass\n\n    def push(self, value):\n        pass\n\n    def pop(self):\n        pass\n\n    def __len__(self):\n        pass\n',
    solutionCode:
      'class Stack:\n    """A last-in, first-out stack."""\n    def __init__(self):\n        self.items = []\n\n    def push(self, value):\n        self.items.append(value)\n\n    def pop(self):\n        return self.items.pop()\n\n    def __len__(self):\n        return len(self.items)\n',
    publicTestCode:
      'import unittest\nfrom submission import Stack\n\nclass Tests(unittest.TestCase):\n    def test_empty(self):\n        self.assertEqual(len(Stack()), 0)\n\n    def test_push_pop(self):\n        stack = Stack()\n        stack.push(3)\n        stack.push(7)\n        self.assertEqual(stack.pop(), 7)\n        self.assertEqual(len(stack), 1)\n\n\nif __name__ == "__main__":\n    unittest.main()\n',
    secretTestCode:
      'import unittest\nfrom submission import Stack\n\nclass Tests(unittest.TestCase):\n    def test_empty_error(self):\n        with self.assertRaises(IndexError):\n            Stack().pop()\n\n    def test_independent(self):\n        a, b = Stack(), Stack()\n        a.push(1)\n        self.assertEqual(len(b), 0)\n\n    def test_lifo_sequence(self):\n        stack = Stack()\n        for value in range(5):\n            stack.push(value)\n        self.assertEqual([stack.pop() for _ in range(5)], [4, 3, 2, 1, 0])\n\n\nif __name__ == "__main__":\n    unittest.main()\n',
  },
  {
    slug: 'regex-dates',
    title: '使用 regex 提取日期',
    stem: '实现 `extract_dates(s)`，按出现顺序返回 `(year, month, day)` 字符串元组列表。日期为 `YYYY-MM-DD`，年份 4 位数字，月份 `01–12`，日期 `01–31`，两侧不得紧邻数字。只验证上述格式，不检查具体月份天数或闰年。例如 `2025-11-12` 返回 `[("2025", "11", "12")]`；`2025/11/12`、`2025-99-99` 不匹配。',
    starterCode:
      'import re\nfrom typing import List, Tuple\n\n\ndef extract_dates(s: str) -> List[Tuple[str, str, str]]:\n    """Extract YYYY-MM-DD dates; month 01-12 and day 01-31.\n\n    A match must not be adjacent to another digit. No calendar validation.\n    """\n    pass\n',
    solutionCode:
      'import re\nfrom typing import List, Tuple\n\n\ndef extract_dates(s: str) -> List[Tuple[str, str, str]]:\n    """Extract YYYY-MM-DD dates; month 01-12 and day 01-31.\n\n    A match must not be adjacent to another digit. No calendar validation.\n    """\n    pattern = r"(?<!\\d)(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])(?!\\d)"\n    return re.findall(pattern, s)\n',
    publicTestCode:
      "import unittest\nfrom submission import extract_dates\n\nclass Tests(unittest.TestCase):\n    def test_multiple_dates(self):\n        self.assertEqual(extract_dates(\"2025-11-12 and 1997-03-18\"), [('2025', '11', '12'), ('1997', '03', '18')])\n\n    def test_separator(self):\n        self.assertEqual(extract_dates(\"2025/11/12\"), [])\n\n\nif __name__ == \"__main__\":\n    unittest.main()\n",
    secretTestCode:
      'import unittest\nfrom submission import extract_dates\n\nclass Tests(unittest.TestCase):\n    def test_ranges(self):\n        self.assertEqual(extract_dates("2025-99-99 2025-00-12 2025-12-00 2025-12-32"), [])\n\n    def test_width_and_boundaries(self):\n        self.assertEqual(extract_dates("25-11-12 2025-1-1 12025-11-12 2025-11-123"), [])\n\n    def test_format_only(self):\n        self.assertEqual(extract_dates("2025-02-31"), [(\'2025\', \'02\', \'31\')])\n\n\nif __name__ == "__main__":\n    unittest.main()\n',
  },
];
