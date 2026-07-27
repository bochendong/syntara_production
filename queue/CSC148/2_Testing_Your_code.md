# 2.1 Testing Your Work

The last step of the [Function Design Recipe](../python-recap/design_recipe.md) is to test your code---but how?
In this section, we discuss the different strategies for testing code that you'll use during the term, and beyond.
As you write more and more complex programs in this course, it will be vital to maintain good habits to support you in your programming.
One of these habits is developing good tests that will ensure your code is correct, and---often overlooked---using good *tools* to make those tests as easy to run as possible.
You want to get in the habit of writing tests early in the process of programming, and running them as often as possible to detect coding errors as soon as you make them.


## Doctests: basic examples in docstrings

Often, beginners test their code by importing their function into the Python interpreter, and then manually copy-and-pasting their examples one at a time and comparing the output with the expected output in the docstring.
This approach is both time-consuming and error-prone.
It may be good for a quick sanity check, but we can certainly do better.

Our first improvement is to use the Python library **doctest**,
which looks for examples in docstrings and converts them automatically into runnable tests!
To use `doctest`, you can add the following code to the bottom of any Python file:

```python
if __name__ == '__main__':
    import doctest     # import the doctest library
    doctest.testmod()  # run the tests
```

Then when you run the file, all of the doctest examples are automatically run, and you receive a report about which tests failed.


## Creating test suites with `pytest`

The problem with `doctest` and putting examples in our docstrings is that we can't include all of the test cases we want to without making the docstrings far too long for the reader.

So while you should continue to put in a few basic doctests inside docstrings, in this course you will primarily use the `pytest` library to test your code.
This library allows us to write our tests in a separate file, and so include an exhaustive set of tests without cluttering our code files.
You see an example of `pytest` in your first lab, and will be seeing plenty more throughout the term.
There are two important points we want to remind you of when using `pytest`:

-   Each function whose name starts with "test" is a separate test. They are all run independently of each other, and in a random order.
-   Tests use the `assert` statement as the actual action that verifies the correctness of your code.
    The `assert` statement is used as follows:

    ```python
    assert <expression>
    ```

    The `<expression>` should be a boolean expression (e.g., `x == 3`) that tests something about your function. We say that an assertion *succeeds* (or *passes*) when its expression evaluates to `True`, and it *fails* when its expression evaluates to `False`.

    A single test function in `pytest` can contain multiple `assert` statements; the test passes if all of the assert statements pass, but it fails when one or more of the `assert` statements fail.


## Choosing test cases

We said earlier that keeping our tests in separate files from our source code enables us to write an exhaustive set of tests without worrying about length.
But what exactly do we mean by "exhaustive?"
In general, it is actually a pretty hard problem to choose test cases to verify the correctness of your program.
You want to capture every possible scenario, while avoiding writing redundant tests.
A good rule of thumb is to structure your tests around **properties of the inputs**.
For example:

- *integers*: 0, 1, positive, negative, "small", "large"
- *lists*: empty, length 1, no duplicates, duplicates, sorted, unsorted
- *strings*: empty, length 1, alphanumeric characters only, special characters like punctuation marks

For functions that take in multiple inputs, we often also choose properties based on the *relationships between the inputs*.
For example, for a function that takes two numbers as input, we might have a test for when the first is larger than the second, and another for when the second is larger than the first.
For an input of one object and a list, we might have a test for when the object is in the list, and another for when the object isn't.

And finally, keep in mind that these are rules of thumb only;
none of these properties will always be relevant to a given function.
For a complete set of tests, you must understand *exactly* what the function does, to be able to identify what properties of the inputs really matter.

<!--

## Property-based testing

The kinds of tests we've discussed so far involve defining *input-output pairs*:
for each test, we write a specific input to the function we're testing, and then use `assert` statements to verify the correctness of the corresponding output.
(For a function that mutates its input,
we use `assert` statements to verify the correctness of the new state of the input after the function executes.)
These tests have the advantage that writing any one individual test is usually straightforward, but the disadvantage that choosing and implementing test cases can be challenging and time-consuming.

There is another way of constructing tests that we will explore in this course: *property-based testing*, in which a single test typically consists of a large set of possible inputs that is generated in a programmatic way.
Such tests have the advantage that it is usually straightforward to cover a broad range of inputs in a short amount of code (using a library like `hypothesis`, as we'll see); but it isn't always easy to specify exactly what the corresponding outputs should be.
If we were to write code to compute the correct answer,
how would we know that *that* code is correct?

So instead, property-based tests use `assert` statements to check for *properties* that the function tested should satisfy.
In the simplest case, these are properties that every output of the function should satisfy,
regardless of what the input was.
For example:

- The *type* of the output: "the function `str` should always return a string."
- *Allowed values* of the output: "the function `len` should always return an integer that is greater than or equal to zero."
- *Relationships* between the input and output: "the function `max(x, y)` should return something that is greater than or equal to both `x` and `y`."

These properties may seem a little strange, because they do not capture precisely what each function does; for example, `str` should not just return any string, but a string that represents its input.
This is the trade-off that comes with property-based testing: in exchange for being able to run our code on a much larger range of inputs, we write tests which are imprecise characterizations of the function's inputs.
The challenge with property-based testing, then, is to come up with good properties that narrow down as much as possible the behaviour of the function being tested.

-->

## Putting it all together

Ideally, we use both of these types of testing in combination:

- `doctest` is used to test basic functionality, as well as to communicate
what the correct behaviour of the function is.
- test suites (developed using a tool like `pytest`) are used to fully assess the correctness of our function
in a range of carefully chosen test cases that we generate by hand.
<!-- - property-based tests (developed using a tool like `hypothesis`) are used for a more shallow assessment of
correctness but on a much larger number of automatically generated test cases. -->

# 2.2 Choosing Test Cases

Testing is incredibly important.
Software on its own, without strong evidence of its correctness, is of no value.
In fact, in many workplaces, the tools used by professionals to manage groups of software developers working on a shared code base won't accept a contribution of new or modified code unless it contains---and passes---a thorough test suite.

We've talked about using a combination of two strategies for testing:
`doctest` and
unit tests (we'll use `pytest` to implement these).
<!-- and property-based tests (we'll use `hypothesis` to implement these). -->
We've also talked a bit about how to choose test cases for a test suite.
Let's look at this more closely.


## An example

Suppose `max` didn't exist in Python and we were writing a function to find the largest element in a list of integers.
Suppose that we have tested the function on the following test cases,
and that it passes them all:

| List                                     | Expected Result            | Test passed? |
|------------------------------------------|----------------------------|--------------|
| `[3, 6, 4, 42, 9]`                       | `42`                       | yes          |
| `[22, 32, 59, 17, 18, 1]`                | `59`                       | yes          |
| `[1, 88, 17 59, 33, 22]`                 | `88`                       | yes          |
| `[1, 3, 5, 7, 9, 1, 3, 5, 7]`            | `9`                        | yes          |
| `[7, 5, 3, 1, 9, 7, 5, 3, 1]`            | `9`                        | yes          |
| `[561, 1024, 13, 79, 97, 4]`             | `1024`                     | yes          |
| `[9, 6, 7, 11, 5]`                       | `11`                       | yes          |

Would you be confident that the function works?
Maybe not---we only checked 7 cases.
What if you were shown that it passed 20 more tests?
How about 100 more?
Even if it passes 1,000 test cases, you should be skeptical.
That may be a lot of tests, but think about how many possible ways there are to call this function.
How do we know the tests don't omit a scenario that could cause failure?

The fundamental problem is that we want to be sure that the code works *in all cases*
but there are too many possible cases to test.
In this Venn diagram, each circle represents a possible call to the function
(of course there are many more than we could draw).
Some of them have been tested.

```{image} images/set1-crop.jpg
:alt: Venn diagram showing tested and untested cases
:width: 450px
:align: center
```

## Making a convincing argument

We may not be able to test every case, but we can still make a convincing argument as follows:

- Divide all possible calls to the function into meaningful categories.
- Pick a representative call from each category.

Our Venn diagram now looks more organized:

```{image} images/set2-crop.jpg
:alt: Venn diagram showing tested and untested cases
:width: 450px
:align: center
```

If we choose the categories well,
for each category it will be reasonable to extrapolate from that one tested call to all the calls in the category:

```{image} images/set3-crop.jpg
:alt: Venn diagram showing tested and untested cases
:width: 450px
:align: center
```

We now have either demonstrated or reasonably inferred correctness in every case.


## How to choose the relevant properties

This kind of argument depends heavily on choosing appropriate categories.
We base the categories on properties of the inputs.
For example, extending what we saw in an earlier reading,
here are some properties and some values for each property:

- the size of an object (could be a list, string, etc.): 0, 1, larger, even, odd
- the position of a value in an ordered sequence (such as a list or string): beginning, ending, elsewhere
- the relative position of two values in an ordered sequence: adjacent, separated
- the presence of duplicates: yes, no
- ordering: unsorted, non-decreasing, non-increasing
- the value of an integer: 0, 1, positive, negative, "small", "large", even, odd
- the value of a string: alphanumeric characters only, special characters like punctuation marks
- the location of whitespace in a string: beginning, ending, elsewhere, multiple occurrences, multiple adjacent whitespace characters, different types of whitespace characters
- and more! Depending on the parameters of a function, there could be many other properties.

Not all of these properties are relevant to any particular function.
We decide which are relevant based on knowing what the function does.
If we also know *how* the function does it, that can influence our choices as well.
For instance, if the function divides a list in half, odd vs. even size is pretty important!

Judgment is also required in choosing which combinations of these properties to test.
There is no right or wrong answer here, but a great way to think of it is this:
**Try to break the code**.
If you use a good strategy and can't break it, you have a good argument that it truly works.

# 2.3 Code Coverage

In the previous section, we learned about a set of strategies for choosing test cases based on properties of the inputs to the function being tested.
This approach is a form of "black box testing", which means that it does not take into account how the function has been implemented.
One of the strengths of black box testing is that we can develop test cases based just on a function's description and its inputs, without having to worry about how it has been implemented.

However, for more complex function implementations, using just black box testing may miss some subtle or very specific cases in the code that we've written.
In this section, we'll introduce a test concept called **code coverage**, which is known as a "white box" testing principle, because the concept is fundamentally about the function's implementation.
To be clear, the concept of code coverage isn't meant to replace or negate the strategies we learned in the previous section!
Rather, we hope that this idea will become a new tool in your "testing toolbox" that you can use to help design test cases throughout this course.

## What is code coverage?

**Code coverage** is a measure of the number of lines of code in a program that were executed at least once when a test suite is run.[^1]
This measure is often reported as a percentage, for example, "90% of lines were covered by this test suite."
Now, this may seem like a fairly obvious measure: shouldn't we expect to test every line of code that we write, so that the code coverage is always 100%?
Well, yes---but if we aren't careful in choosing test cases, it is possible to miss out on some lines, especially as our function bodies get more complex.

Let's consider the following example.

```python
def shortest_string(strings: list[str]) -> str | None:
    """Return the shortest string in <strings>.

    If there is a tie, return the string that is considered smaller
    when comparing using <.

    If <strings> is empty, return None.
    """
    if strings == []:
        return None

    shortest = strings[0]  # Set the accumulator to be the first string
    for string in strings:
        if len(string) < len(shortest):
            shortest = string
        elif len(string) == len(shortest) and string < shortest:
            shortest = string

    return shortest
```

If we focused only on properties of the input `strings`, we might identify the following cases:

- `strings` is empty
- `strings` is non-empty and has no ties for the shortest string
- `strings` is non-empty and has a tie for the shortest string

Here are three test cases for this function:

```python
def test_empty() -> None:
    """Test shortest_string on an empty list."""
    actual = shortest_string([])
    expected = None

    assert actual == expected


def test_no_ties() -> None:
    """Test shortest_string on a non-empty list with no ties for shortest length."""
    actual = shortest_string(['cat', 'a', 'computer'])
    expected = 'a'

    assert actual == expected


def test_ties() -> None:
    """Test shortest_string on a non-empty list with a tie for shortest length."""
    actual = shortest_string(['cat', 'a', 'b'])
    expected = 'a'

    assert actual == expected
```

While these test cases certainly cover different possibilities, they are not yet complete.
Take a moment to see if you can spot why.

With all three of these test cases, *the second `shortest = string` statement, inside the `elif` branch, never executes!*
To see evidence of this, try modifying this line of code so there's an error (e.g., change `string` to `strng`) and run the three tests.
They'll still all pass!

### Improving test code coverage

Once we've identified a line of code that isn't being executed, how do we fix it?
We need to study the code to figure out what kind of input we can give to `shortest_string` to make that line run.
Let's take a closer look at that for loop:

```python
    shortest = strings[0]  # Set the accumulator to be the first string
    for string in strings:
        if len(string) < len(shortest):
            shortest = string
        elif len(string) == len(shortest) and string < shortest:
            shortest = string
```

In order for the `elif` branch to execute, we need there to be a tie (so `len(string) == len(shortest)`), but *also* for the current string `string` to be less than `smallest`.[^2]
This is why our third test case input `['cat', 'a', 'b']`, which did have a tie in shortest length, didn't trigger this code: `'b'` is *not* less than `'a'`.
Here is a new test case that will cause the `elif` branch to execute:

```python
def test_ties_2() -> None:
    """Test strings on a non-empty list with ties for shortest length,
    where the smaller string comes second in the list."""
    actual = shortest_string(['cat', 'b', 'a'])
    expected = 'a'

    assert actual == expected
```

Now, there is another way we could have come up with this additional test case.
From the previous chapter, we learned that *list ordering* is often a useful property to vary across test cases, and the only difference in our new test case is the relative order of the `'a'` and `'b'`.
However, considering code coverage gave us an alternate way of discovering a gap in our test cases, and prompted us to think more deeply about the function's code.

## Running tests with code coverage

Code coverage is not just a theoretical concept---modern testing libraries like `pytest` have ways of tracking code coverage automatically when tests are run.

For example, using [Coverage](https://coverage.readthedocs.io/en/7.4.0/), we need to do the following steps:

1. Create a Coverage object
2. Start recording coverage
3. Run the code (e.g. the test suite) that we want to check the coverage of
4. Stop recording coverage
5. Save the coverage results
6. Report the results

For example, suppose our code is in a file called `my_functions.py`, and all four of our tests are in a file called `test_my_functions.py`.
Then we can execute these tests by adding the following main block to `my_functions.py`:

```python
if __name__ == '__main__':  # pragma: no cover
    import pytest
    import coverage

    # This creates a Coverage() object and starts recording information
    # about which lines have been run in my_functions.py
    cov = coverage.Coverage(include=['my_functions.py'])
    cov.start()

    # This line runs the pytest cases in test_my_functions.py
    pytest.main(['test_my_functions.py'])

    # These lines stop recording information and saves it
    cov.stop()
    cov.save()

    # The line below will print the report to the Python Console.
    cov.report()

    # The line below will generate a folder called htmlcov
    # Open the index.html page to see the coverage report. You can
    # click on the "my_functions.py" module there to see
    # which lines might be missing.
    cov.html_report()
```

When we run this, we'll see the standard `pytest` output, but also a new folder called `htmlcov` will be created.
Inside this folder if we open up the file `index.html`, we'll see a webpage with the following information:

```{image} images/code_coverage1.png
:alt: Screenshot of code coverage webpage, index.html
:width: 450px
:align: center
```

If we then click on the `my_functions.py` link, we'll be taken to a new page that shows us exactly which lines of code were missed when running our tests:

```{image} images/code_coverage2.png
:alt: Screenshot of code coverage webpage, my_functions.py
:width: 600px
:align: center
```

*Note*: with this way of running pytest, we have excluded the main block from the code coverage analysis by using the special syntax `# pragma: no cover`. You can try removing that comment to see that the main block will now show as being missing. In any case, what's important is that every line of code in the *body* of the function is run at least once!

As an exercise, try commenting out the additional test we added above and run `my_functions.py` again to easily identify which line wasn't being covered previously.

## The limits of code coverage

While code coverage is a useful metric for evaluating test cases, attaining "100% code coverage" should not be confused with having a high-quality test suite.
In practice, it may be very cumbersome to execute every line of a software's source code through automated testing alone, such as when working with algorithms involving randomness or programs involving complex interactions between computer systems and/or human users.
Attaining 100% code coverage does not necessarily mean that the test suite covers all possible cases, or that the function's implementation is error-free.
Just because each line of code is executed at least once doesn't mean that different possible combinations of lines of code all execute correctly.[^3]

So as you proceed in CSC148, please keep code coverage in mind when designing your test cases, but don't treat it as the one and only factor when testing.
There are many strategies and considerations you'll use to design your test cases, and code coverage is just one of them.

[^1]: Code coverage excludes lines like comments and docstrings, since those are meant for documentation purposes only.
[^2]: By "less than", we mean when the strings are compared using the `<` operator in Python.
[^3]: The type of code coverage we've discussed in this section is known as *statement coverage*, since it is concerned with the statements (loosely referred to as "lines of code") executed by the test suite. A more sophisticated form of code coverage is called *branch coverage*, which encomapsses all possible execution paths through a program, taking into account branching due to if statements and other control flow statements. However, even attaining 100% branch coverage---that is, covering all possible execution paths---is not sufficient to be certain that there are no bugs in your code!

# 2.4 Introduction to Property-Based Testing

Hypothesis is a Python testing library that we'll use occasionally in this course
for exercises and assignments.
It's already available on the Teaching Lab machines, and you should have installed it on your own computer when you went through the steps of the Software Guide on Quercus.

When writing tests, we often try to identify key properties on the inputs to the function being tested. We then pick representative inputs that meet these properties, and use these inputs to write tests.
We can extend this idea to trying to identify key properties of the function itself:
central relationships between their inputs and outputs that must hold for all possible inputs.
This type of testing is called **property-based testing**,
and the most famous implementation of this type of testing in Python is the `hypothesis` library.


## An example

Let's see a concrete example of what these property tests might look like.
Consider the following function:

```python
def insert_after(lst: list[int], n1: int, n2: int) -> None:
    """After each occurrence of <n1> in <lst>, insert <n2>.

    >>> lst = [5, 1, 2, 1, 6]
    >>> insert_after(lst, 1, 99)
    >>> lst
    [5, 1, 99, 2, 1, 99, 6]
    """
```

We'll test two properties of this function, which should hold for any valid input:

1.  `insert_after` always returns `None`.
2.  `insert_after` increases the length of `lst` by the number of times that `n1` occurs in that list.

Our first test is the following:

```python
from hypothesis import given
from hypothesis.strategies import integers, lists

from insert import insert_after


@given(lists(integers()), integers(), integers())
def test_returns_none(lst: list[int], n1: int, n2: int) -> None:
    """Test that insert_after always returns None.
    """
    assert insert_after(lst, n1, n2) is None
```

The test case (`test_returns_none`) is preceded by the line `@given(lists(integers()), integers(), integers())`;
what this line does is tell `hypothesis` to generate "random" inputs of the given types: a list of integers, and then two other integers.
These values are then passed to the test function,
which then simply calls `insert_after` on them, and checks that the output is `None`.

The most interesting part is that the "`given`" line doesn't just generate one set of random inputs; instead, it generates dozens of them (or even hundreds, depending on how hypothesis is configured), and runs this test function on each one!
We call the input specifiers like `integers()` or `lists()` a *strategy*;
we'll see more examples of strategies throughout the term.

### A more complex property

Even though the previous test looked pretty straight-forward, don't be fooled!
Since a property test is just a Python function, we can write pretty complex tests using all of our Python knowledge.

For example, to test the second property we mentioned, we'll need to store both the original length of `lst`, and the number of times that `n1` appeared in it:

```python
@given(lists(integers()), integers(), integers())
def test_new_item_count(lst: list[int], n1: int, n2: int) -> None:
    """Test that the correct number of items is added.
    """
    num_n1_occurrences = lst.count(n1)
    original_length = len(lst)
    insert_after(lst, n1, n2)

    final_length = len(lst)

    assert final_length - original_length == num_n1_occurrences
```

## Further reading

Hypothesis is a powerful property-based testing library, and we're only scratching the surface of it here.
If you'd like more information, please consult the [official Hypothesis documentation](https://hypothesis.readthedocs.io/en/latest/index.html).

