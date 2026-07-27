# 5.1 Introduction to Exceptions


In the last chapter,
we went through a few examples to give you an idea of how to catch and handle exceptions.
There's more to know about options for handling exceptions, so let's take
a closer look.
Please refer to the Python documentation
on [exceptions](https://docs.python.org/3/tutorial/errors.html)
for full details.
The sections
on [handling exceptions](https://docs.python.org/3/tutorial/errors.html#handling-exceptions)
and [defining clean-up actions](https://docs.python.org/3/tutorial/errors.html#defining-clean-up-actions)
are particularly relevant.


Before we launch in, let's clear up some terminology.

In programming, an exception refers to an unusual event that disrupts the
normal flow of control.
Various languages have different features for defining, raising, and handling exceptions, and they may use different terminology.
For example, in Java, a distinction is made between "exceptions" and "errors".
In Python, there is no separate category for "errors".
Every kind of exception,
whether a built-in type of exception or one that we define ourselves, is a
subclass of `Exception`.[^1]

**Raising** an exception
refers to what happens when a program creates an instance of an exception class and interrupts normal execution of the program's code.
We can raise an exception directly by using the keyword `raise`,
or we can cause it to happen indirectly by writing code
in a way that raises an error,
as in this line:

```python
int('good luck converting this to an int!')
```

We also talk about *throwing* an exception, which means the same thing
as raising an exception.
This terminology alludes to a metaphor:
you can think of an exception as a hot potato that no one wants to hold,
so they keep throwing it to someone else. Perhaps eventually someone
is willing to handle the hot potato and therefore doesn't pass it on.

**Catching** an exception means handling it and allowing normal
program execution to resume.

[^1]: This isn't quite true, but is close enough for our purposes. The full story is that `Exception` is a child of a class called `BaseException`.
Any class that is a descendant of `BaseException`
but is not a descendant of `Exception`
is intended to be used in situations where the program really *should* terminate.
For instance, a `KeyboardInterrupt` is raised when the user hits
the interrupt key to stop the program.
Although these types of exception
*can* be caught and handled, they typically are not.

# 5.2 General Rules for try-except

## If there is a suitable handler

When an exception is raised,
if there is a try-except around the line of code that raised it,
Python checks each of the `except` clauses, in order, to see if it handles the type of exception that was raised.
The first `except` clause that does will handle the exception: execution will jump to its `except` clause, skipping over any additional lines that may
exist in the `try` block.
Then the program will continue with whatever comes after
the whole try-except statement.

For example, consider what happens in this function if `num2` is 0:

```python
def divide(num1: int, num2: int) -> None:
    try:
        answer = num1 / num2
        print(f'The answer is {answer}')
    except ZeroDivisionError:
        print(f'Cannot divide {num1} by zero!')


if __name__ == '__main__':
    divide(23, 0)
```

The assignment statement `answer = num1 / num2` will raise a `ZeroDivisionError`.
The `except` clause matches it, so we immediately leave the `try` block
and print `Cannot divide 23 by zero!`.
The message saying "The answer is ..." is skipped.

It is possible to end a try-except statement with a "bare" except clause,
that is, one with no specific type of exception named.

```python
    try:
        # Some code goes here.
        pass
    except ZeroDivisionError:
        print('Something went wrong: attempt to divide by zero!')
    except TypeError:
        print('Something went wrong: type error!')
    except:   # No type of exception specified
        print('Something went wrong: I have no idea what!')
```

Similarly, we can use `Exception` as a wildcard that catches (almost)
every kind of exception:

```python
    try:
        # Some code goes here.
        pass
    except ZeroDivisionError:
        print('Something went wrong: attempt to divide by zero!')
    except TypeError:
        print('Something went wrong: type error!')
    except Exception:  # Very broad type of exception specified
        print('Something went wrong: I have no idea what!')
```

In either case, PyCharm will warn us that this is a
"Too broad exception clause".
You might wonder why, since it is similar to an if-statement that has a
final `else` clause with no condition.  While fine for if-statements, this is
considered bad style for exceptions.
It is good practice to be as specific as possible with the types of exceptions that we intend to handle.
If there is a kind of exception that we didn't specifically anticipate,
or we don't have specific code to handle,
we should allow the exception to propagate on to other code
that is better prepared to handle it.


## How could there be more than one `except` clause for a given exception?

Inheritance!

A clause that says `except <X>` will catch
an exception of type X or any descendant of X.
In the example below,
function `nonsense` handles exceptions that are part
of a little inheritance hierarchy:

```python
class TopException(Exception):
    pass

class MiddleException(TopException):
    pass

class BottomException(MiddleException):
    pass

def nonsense(num: int) -> None:
    try:
        if num > 100:
            raise TopException
        elif num < 0:
            raise MiddleException
        elif num == 0:
            raise BottomException
        else:
            print('All is well.')
    except MiddleException:
        print('A MiddleException occurred!')
```

<!--
Makes sense because of "is-a".
Doesn't accept something more general.
Also makes sense; if you can handle a car, you can handle a Toyota or BMW,
but you can't handle a helicopter!
-->

If we call `nonsense(-3)`, a `MiddleException` will be raised
and then caught, and we will see the message `A MiddleException occurred!`.
But a `BottomException` is-a kind of `MiddleException`, so
if we call `nonsense(0)`, the `BottomeException` that is raised
will be caught and handled just the same.
What if we call `nonsense(142)`?
This raises a `TopException`.
Since `TopException` is *not* a kind of `MiddleException`,
the exception is not caught;
instead the stack frame is popped and the exception propogates to the caller.

Suppose we want to write the code so that it can specifically handle
each of these types of exception.
Because of the way that inheritance influences the matching of a raised exception
to an `except` clause, we have to be careful about the order in which
we place the `except` clauses.
For example, here we put `except TopException` first:

```python
def nonsense_v2(num: int) -> None:
    try:
        if num > 100:
            raise TopException
        elif num < 0:
            raise MiddleException
        elif num == 0:
            raise BottomException
        else:
            print('All is well.')
    except TopException:  # Catches all 3 types of exception!
        print('A TopException occurred!')
    except MiddleException:  # Cannot be reached.
        print('A MiddleException occurred!')
    except BottomException:  # Cannot be reached.
        print('A BottomException occurred!')
```

But `except TopException` catches all three of these types of exception, so
neither of the subsequent `except` clauses can ever be reached.
If we want all three `except` clauses to contribute, we must
catch the exceptions in order from most-specific to least-specific:

```python
def nonsense_v3(num: int) -> None:
    try:
        if num > 100:
            raise TopException
        elif num < 0:
            raise MiddleException
        elif num == 0:
            raise BottomException
        else:
            print('All is well.')
    except BottomException:
        print('A BottomException occurred!')
    except MiddleException:
        print('A MiddleException occurred! (and it was not a BottomException)')
    except TopException:
        print('A TopException occurred (and it was not a Bottom or MiddleException)')
```


## If there is no suitable handler

Suppose function `<X>` calls function `<Y>`
and `<Y>` raises an exception.
If there is no try-except around the line of code that raises the exception, or
there is one but it lacks an except clause for the particular kind of exception
raised,
then the stack frame for `<Y>` *immediately* is popped.
We come back to the line
of code in `<X>` that called `<Y>`---and that line of code receives the
exception.
This process continues until either some function on the stack handles
the exception, or the the whole stack has been popped empty. In that case, the
user sees the exception.

Here's an example where the call stack has several frames on it when
an exception may occur:

```python
def f3() -> None:
    x = input('Enter a number: ')
    print(100 / int(x))
    print('That went well')


def f2() -> None:
    f3()


def f1() -> None:
    f2()


if __name__ == '__main__':
    f1()
    print('All done.')
```

When the code reaches `f3`, the stack has on it frames for
the main block (on the bottom), `f1`, `f2`, and `f3` (on the top).
If the user enters either 0 or something other than an integer,
an exception will be raised in `f3`.
Since there is no `try-except` clause, the function will immediately
return, sending the exception to `f2`.
At this point, it's no different than if `f2` had raised the exception itself.
Since `f2` has no `try-except` clause either,
it immediately returns, sending the exception to `f1`,
and `f1` does the same, sending the exception to the main block.
We have just that one frame left on the stack, and it is popped too,
leaving the error message to land in the lap of the user:

```python
Enter a number: no thanks
Traceback (most recent call last):
  File "148-materials/notes/exceptions/code/popall.py", line 16, in <module>
    f1()
  File "148-materials/notes/exceptions/code/popall.py", line 12, in f1
    f2()
  File "148-materials/notes/exceptions/code/popall.py", line 8, in f2
    f3()
  File "148-materials/notes/exceptions/code/popall.py", line 3, in f3
    print(100 / int(x))
ValueError: invalid literal for int() with base 10: 'no thanks'

Process finished with exit code 1
```

Below is a new version where we *handle* both kinds of exception.
We chose to handle any `ZeroDivisionError` in `f2` and any
`ValueError` in `f1`,
but we could have put these handlers anywhere along the chain of function calls.

```python
def f3() -> None:
    x = input('Enter a number: ')
    print(100 / int(x))
    print('That went well')


def f2() -> None:
    try:
        f3()
    except ZeroDivisionError:
        print('In f2 and my call to f3 raised a ZeroDivisionError')


def f1() -> None:
    try:
        f2()
    except ValueError:
        print('In f1 and my call to f2 raised a ValueError')


if __name__ == '__main__':
    f1()
    print('All done.')
```

If the user enters 0, a `ZeroDivisionError` exception is raised and
the frame for `f3` is popped as before, but now in `f2`
there is a handler that takes care of the exception and the program
can continue as if there had never been an exception raised.

```
Enter a number: 0
In f2 and my call to f3 raised a ZeroDivisionError
All done.
```

Or if the user enters something other than an integer,
a `ValueError` is raised in `f3`, the frame for `f3` is popped,
as is the frame for `f2`, since it can't handle that type of exception.
But then we reach `f1`, which has a handler for `ValueError`s.
`f1` catches the exception, and the program continues.

```
Enter a number: hee hee!
In f1 and my call to f2 raised a ValueError
All done.
```


## If an `except` clause itself raises an exception

Here, an `except` caluse itself raises an exception:

```python
    try:
        # Some code goes here.
        pass
    except ZeroDivisionError:
        n = int('ridiculous!')   # Can't be handled by this try-except.
    except TypeError:
        print('Something went wrong: type error!')
```

The `except` clauses in this try-except statement only handle exceptions that occur in *this* `try` clause.
So
Python immediately stops, pops the stack, and passes the exception on to
the code that called this method or function.
That is, unless the try-except is nested inside *another* try-except.
In CSC148, we won't go further into this or some of the other special cases
that can occur.
See the Python documentation if you'd like to learn more.

# 5.3 Why Not Just Return a Special Value?

You may be thinking that
all of this exception stuff seems a little complicated.
Why don't we just return a special value to indicate that there was a problem?
There are two very good reasons.


## Exceptions yield code that is more robust

If we return a special value, the code that called the method or function can ignore the problem.
It shouldn't, but it can.
This may cause a problem later.
This simply can't happen with exceptions,
because an exception cannot be ignored.
If an exception is never caught and handled, it will crash the program and the exception will be printed.
This is very unsatisfying for the user,
but much preferrable to the problem being ignored and the program continuing
to run and perhaps producing incorrect results, with no warning to the
user that this has happened!


## Exceptions yield cleaner code

What if we want to use the approach of returning a special value and
are willing to be more careful than this?
If the calling code isn't going to ignore the problem, it has to do some work.
At the very least, it must
notice that a special value was returned, and return a special value
to *its* caller. Its caller must do the same, and its caller,
and so on.
If instead our function raises an exception,
all the handling code can be located in one spot (or fewer spots),
assuming that the same steps for handling the exception are suitable.
As long as somewhere on the call stack there is guaranteed to be a
function that will catch and handle the exception,
none of the other methods or functions have to.

A realistic example will help make this concrete.
The program below reads lists of numbers from a file and reports how many of
those lists represent a "magic square" (a square all of whose rows
and all of whose columns add up to the same number).
The code itself runs properly if the input file has appropriate contents.
But many things can go wrong if it doesn't, and this can result in
exceptions being raised.
This version of the code just lets that happen,
although it does take care to document this behaviour.
Read the docstrings to see what what sorts of exceptions can occur where.

```python
# Version 1: Let exceptions happen

def fill_matrix(numbers: list[int], n: int) -> list[list[int]]:
    """Return a matrix with values from <numbers>. Each row in the matrix will
    have n items, except the last line, which may be shorter.

    Precondition: n >= 1

    >>> stuff = [1, 2, 3, 4, 5, 6, 7]
    >>> m = fill_matrix(stuff, 3)
    >>> m
    [[1, 2, 3], [4, 5, 6], [7]]
    """
    answer = []
    i = 0   # An index into <numbers>.
    while i < len(numbers):
        next_row = []
        c = 0   # The logical column number corresponding to numbers[i]
        while c < n and i < len(numbers):
            next_row.append(int(numbers[i]))
            i += 1
            c += 1
        answer.append(next_row)
    return answer


def row_sum(m: list[list[int]], r: int) -> int:
    """Return the sum of all values in row <r> of matrix <m>.

    Raise an IndexError if <r> is not a valid row of <m>.

    >>> m = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
    >>> row_sum(m, 1)
    15
    """
    total = 0
    for i in range(len(m[0])):
        total += m[r][i]
    return total


def col_sum(m: list[list[int]], c: int) -> int:
    """Return the sum of all values in row <r> of matrix <m>.

    Raise an IndexError if <c> is not a valid column in each row of <m>.

    >>> m = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
    >>> col_sum(m, 2)
    18
    """
    total = 0
    for i in range(len(m[0])):
        total += m[i][c]
    return total


def is_magic(m: list[list[int]]) -> bool:
    """Return whether <m> is a magic square.

    Raise an IndexError if <m> is not a square matrix.

    >>> is_magic([[1, 2, 3], [4, 5, 6], [7, 8, 9]])
    False
    >>> is_magic([[5, 5, 5], [5, 5, 5], [5, 5, 5]])
    True
    """
    first_row = row_sum(m, 0)
    for i in range(len(m[0])):
        total = row_sum(m, i)
        if total != first_row:
            return False
        c = col_sum(m, i)
        if c != first_row:
            return False
    return True


def num_magic(filename: str, n: int) -> int:
    """Return the number of magic squares in the file with name <filename>.

    Raise an IndexError if one or more input lines does not have n x n items.
    Raise a FileNotFoundError if there is no such file.
    Raise a ValueError if the file contains values that are not integers.
    """
    count = 0

    with open(filename) as infile:
        for line in infile:
            items = line.strip().split()
            nums = [int(s) for s in items]  # Uses a "list comprehension"
            m = fill_matrix(nums, n)
            if is_magic(m):
                count += 1

    return count


if __name__ == '__main__':
    num = num_magic('numbers.txt', 3)
    print(num)
```

If we run this program and the file doesn't exist, or one of its lines
does not contain enough numbers to fill a 3-by-3 matrix,
or it has anything in it that can't be interpreted as an `int`, then
an exception will be raised, the stack will be cleared, and the user
will see the exception.

Suppose we want to do better, but without having to catch exceptions.
We can have our functions return a special value instead.
Here is a version of the program that takes this approach.[^1]

```python
# Version 2: Return special values instead

def fill_matrix(numbers: list[int], n: int) -> list[list[int]]:
    """Return a matrix with values from <numbers>. Each row in the matrix will
    have n items, except the last line, which may be shorter.

    Precondition: n >= 1

    >>> stuff = [1, 2, 3, 4, 5, 6, 7]
    >>> m = fill_matrix(stuff, 3)
    >>> m
    [[1, 2, 3], [4, 5, 6], [7]]
    """
    answer = []
    i = 0   # An index into <numbers>.
    while i < len(numbers):
        next_row = []
        c = 0   # The logical column number corresponding to numbers[i]
        while c < n and i < len(numbers):
            next_row.append(int(numbers[i]))
            i += 1
            c += 1
        answer.append(next_row)
    return answer


def row_sum(m: list[list[int]], r: int) -> int:
    """Return the sum of all values in row <r> of matrix <m>,
    or -1 if <r> is not a valid row of <m>.

    >>> m = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
    >>> row_sum(m, 1)
    15
    """
    if not (0 <= r < len(m)):
        return -1
    else:
        total = 0
        for i in range(len(m[0])):
            total += m[r][i]
        return total


def col_sum(m: list[list[int]], c: int) -> int:
    """Return the sum of all values in row <r> of matrix <m>,
    or -1 if <c> is not a valid column in each row of <m>.

    >>> m = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
    >>> col_sum(m, 2)
    18
    """
    total = 0
    for i in range(len(m[0])):
        if not 0 <= c < len(m[i]):
            return -1
        else:
            total += m[i][c]
    return total


def is_magic(m: list[list[int]]) -> bool | None:
    """Return a bool indicating whether or not <m> is a magic square,
    or None if <m> is not a square matrix.

    >>> is_magic([[1, 2, 3], [4, 5, 6], [7, 8, 9]])
    False
    >>> is_magic([[5, 5, 5], [5, 5, 5], [5, 5, 5]])
    True
    """
    first_row = row_sum(m, 0)
    for i in range(len(m[0])):
        total = row_sum(m, i)
        if total == -1:
            return None
        else:
            if total != first_row:
                return False
            c = col_sum(m, i)
            if c == -1:
                return None
            else:
                if c != first_row:
                    return False
    return True


def num_magic(filename: str, n: int) -> int:
    """Return the number of magic squares in the file with name <filename>.

    Raise a FileNotFoundError if there is no such file.
    Raise a ValueError if the file contains values that are not integers.
    """
    count = 0

    with open(filename) as infile:
        for line in infile:
            items = line.strip().split()
            nums = [int(s) for s in items]  # Uses a "list comprehension"
            m = fill_matrix(nums, n)
            if is_magic(m):
                count += 1

    return count


if __name__ == '__main__':
    num = num_magic('numbers.txt', 3)
    print(num)
```

Notice that many docstrings have changed:
instead of saying that the function raises an exception, they say
that a special value is returned in a certain case.
We also changed the type contract for `is_magic` to allow for
a special value (`None`).

You may notice that this code is more cumbersome.
Both `row_sum` and `col_sum` have to check for a valid
index because they both are susceptible to that problem.
And `is_magic` has to do so as well, since it calls these and could
receive a special value from them.
All three functions are dealing with the same sort of problem, and the
code is repetitive.
And the extra logic to check for problems and return special values
also obfuscates the "normal" case.

If we use exceptions, we can gather all the checking into one place.
Here we've gathered it into `num_magic`:

```python
# Version 3: Catch exceptions

def fill_matrix(numbers: list[int], n: int) -> list[list[int]]:
    """Return a matrix with values from <numbers>. Each row in the matrix will
    have n items, except the last line, which may be shorter.

    Precondition: n >= 1

    >>> stuff = [1, 2, 3, 4, 5, 6, 7]
    >>> m = fill_matrix(stuff, 3)
    >>> m
    [[1, 2, 3], [4, 5, 6], [7]]
    """
    answer = []
    i = 0   # An index into <numbers>.
    while i < len(numbers):
        next_row = []
        c = 0   # The logical column number corresponding to numbers[i]
        while c < n and i < len(numbers):
            next_row.append(int(numbers[i]))
            i += 1
            c += 1
        answer.append(next_row)
    return answer


def row_sum(m: list[list[int]], r: int) -> int:
    """Return the sum of all values in row <r> of matrix <m>.

    Raise an IndexError if <r> is not a valid row of <m>.

    >>> m = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
    >>> row_sum(m, 1)
    15
    """
    total = 0
    for i in range(len(m[0])):
        total += m[r][i]
    return total


def col_sum(m: list[list[int]], c: int) -> int:
    """Return the sum of all values in row <r> of matrix <m>.

    Raise an IndexError if <c> is not a valid column in each row of <m>.

    >>> m = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
    >>> col_sum(m, 2)
    18
    """
    total = 0
    for i in range(len(m[0])):
        total += m[i][c]
    return total


def is_magic(m: list[list[int]]) -> bool:
    """Return a bool indicating whether or not <m> is a magic square.

    Raise an IndexError if m is not a square matrix.

    >>> is_magic([[1, 2, 3], [4, 5, 6], [7, 8, 9]])
    False
    >>> is_magic([[5, 5, 5], [5, 5, 5], [5, 5, 5]])
    True
    """
    first_row = row_sum(m, 0)
    for i in range(len(m[0])):
        total = row_sum(m, i)
        if total != first_row:
            return False
        c = col_sum(m, i)
        if c != first_row:
            return False
    return True


def num_magic(filename: str, n: int) -> int:
    """Return the number of magic squares in the file with name <filename>.
    """
    try:
        count = 0

        with open(filename) as infile:
            for line in infile:
                items = line.strip().split()
                nums = [int(s) for s in items]  # Uses a "list comprehension"
                m = fill_matrix(nums, n)
                if is_magic(m):
                    count += 1

        return count
    except IndexError:
        print(f'Warning: One or more input lines did not have {n}x{n} items.')
        return count
    except FileNotFoundError:
        print(f'File {filename} does not exist.')
        return 0
    except ValueError:
        print('Warning: One or more input lines had invalid data.')
        return count


if __name__ == '__main__':
    num = num_magic('numbers.txt', 3)
    print(num)
```

This code is much cleaner and easier to read because:

- Functions `row_sum`, `col_sum` and `is_magic` can ignore potential problems
and focus on their jobs (just being sure to document the exceptions they may raise).
- We only have to deal with potential `IndexError`s in one place, function
`num_magic`.

While we were revising `num_magic` to handle that exception,
we added code to handle the two other kinds of exceptions that could occur
in this function.
We removed the notice in the docstring about exceptions that
could be raised, since this version of the function does not raise any
of these exceptions.

One last note: there are other places we could have put the exception handlers.
For example, we could have handled the `IndexError`s in `is_magic`, leaving
`num_magic` to handle only exceptions of type `FileNotFoundError` and `ValueError`.
Or we could have put all the exception handling in the main block.
There are many options, and these are design decisions.

[^1]: In `num_magic`, we have not attempted to detect a missing file
before a `FileNotFoundError` can be raised or to detect a problematic string
before a `ValueError` can be raised, as this is a bit more work than
catching and handling the other kinds of exceptions in this program.

# 5.4 Additional Clauses

## An `else` clause

If the try-block runs without raising any exception, any `except` clauses
in it are skipped and the entire try-catch is finished.
But if there is something we want to do specifically in that case,
we can add an `else` clause after all the `except` clauses.
The code in the `else` clause is executed
if the try-block runs *without* raising any exception.

Here's an example:

```python
def gibberish(d: dict[int: str], num: int) -> None:
    try:
        k = int(len(d) / num)
        answer = d[k]
        print(f'The answer is {answer}')
    except ZeroDivisionError:
        print(f'Cannot divide by zero!')
    except KeyError:
        print(f'Key {k} does not exist!')
    else:
        print('No problems occurred.')
```

The `else` clause executes only if no kind of exception is raised.
If a `ZeroDivisionError` or `KeyError` is raised, or even if another kind of
exception not handled by an `except` clause is raised,
the `else` clause is skipped.
Think of the `else` clause as saying
"else if there was no exception at all, ..."
(and not "else if there was some other kind of exception ...").

## A `finally` clause

There is one last option: we can add a `finally` clause.
The code in this clause is executed no matter what:
whether or not an exception was raised, or if one was raised,
whether or not it was handled by an `except` clause.
The designers of Python intended it for taking care of any clean-up step(s)
that should happen under all circumstances.

Here we've added a `finally` to our `gibberish` function:

```python
def gibberish(d: dict[int: str], num: int) -> None:
    try:
        k = int(len(d) / num)
        answer = d[k]
        print(f'The answer is {answer}')
    except ZeroDivisionError:
        print(f'Cannot divide by zero!')
    except KeyError:
        print(f'Key {k} does not exist!')
    else:
        print('No problems occurred.')
    finally:
        print('Regardless, here we are.')
```

The "Regardless" statement is printed no matter what happens:

```python
>>> gibberish_v2({6: 'twas', 2: 'brillig', 15: 'slithy', 3: 'toads'}, 2)
The answer is brillig
No problems occurred.
Regardless, here we are.
>>> gibberish_v2({6: 'twas', 2: 'brillig', 15: 'slithy', 3: 'toads'}, 0)
Cannot divide by zero!
Regardless, here we are.
>>> gibberish_v2({6: 'twas', 2: 'brillig', 15: 'slithy', 3: 'toads'}, 3)
Key 1 does not exist!
Regardless, here we are.
```

