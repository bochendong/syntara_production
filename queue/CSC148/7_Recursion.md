# 7.1 Motivation: Adding Up Numbers

This week, we're going to learn about a powerful technique called **recursion**,
which we'll be using in various ways for the rest of the course.
However, recursion is much more than just a programming technique,
it is *a way of thinking* about solving problems.
This new way of thinking can be summarized in this general strategy:
identify how an object or problem can be broken down into *smaller instances with the same structure*.

Let's begin with a series of problems that will demonstrate the need for recursion.


## Summing lists and nested lists

Consider the problem of computing the sum of a list of numbers. Easy enough:

```python
def sum_list(lst: list[int]) -> int:
    """Return the sum of the items in a list of numbers.

    >>> sum_list([1, 2, 3])
    6
    """
    s = 0
    for num in lst:
        s += num
    return s
```

But what if we make the input structure a bit more complex: a list of lists of numbers? After a bit of thought, we might arrive at using a nested loop to process individual items in the nested list:

```python
def sum_list2(lst: list[list[int]]) -> int:
    """Return the sum of the items in a list of lists of numbers.

    >>> sum_list2([[1], [10, 20], [1, 2, 3]])
    37
    """
    s = 0
    for list_of_nums in lst:
        for num in list_of_nums:
            s += num
    return s
```

And now what happens if we want yet another layer, and compute the sum of the items in a list of lists of lists of numbers? Some more thought leads to a "nested nested list":

```python
def sum_list3(lst: list[list[list[int]]]) -> int:
    """Return the sum of the items in a list of lists of lists of numbers.

    >>> sum_list3([[[1], [10, 20], [1, 2, 3]], [[2, 3], [4, 5]]])
    51
    """
    s = 0
    for list_of_lists_of_nums in lst:
        for list_of_nums in list_of_lists_of_nums:
            for num in list_of_nums:
                s += num
    return s
```

Of course, you see where this is going: every time we want to add a new layer of nesting to the list, we add a new layer to the `for` loop. Note that this is quite interesting from a "meta" perspective: the structure of the data is mirrored in the structure of the code which operates on it.

### Simplifying using helpers

You might have noticed the duplicate code above: in fact, we can use `sum_list` as a helper for `sum_list2`, and `sum_list2` as a helper for `sum_list3`:

```python
def sum_list(lst: list[int]) -> int:
    """Return the sum of the items in a list of numbers.
    """
    s = 0
    for num in lst:
        # num is an int
        s += num
    return s

def sum_list2(lst: list[list[int]]) -> int:
    """Return the sum of the items in a list of lists of numbers.
    """
    s = 0
    for list_of_nums in lst:
        # list_of_nums is a list[int]
        s += sum_list(list_of_nums)
    return s

def sum_list3(lst: list[list[list[int]]]) -> int:
    """Return the sum of the items in a list of lists of lists of numbers.
    """
    s = 0
    for list_of_lists_of_nums in lst:
        # list_of_lists_of_nums is a list[list[int]]
        s+ = sum_list2(list_of_lists_of_nums)
    return s
```

While this is certainly a nice simplification, it does not generalize very nicely.
If we wanted to implement `sum_list10`, a function which works on lists with ten levels of nesting, our only choice with this approach would be to first define `sum_list4`, `sum_list5`, etc., all the way up to `sum_list9`.

### Heterogeneous lists

There is an even bigger problem: no function of this form can handle nested lists with a non-uniform level of nesting among its elements, like

```python
[[1, [2]], [[[3]]], 4, [[5, 6], [[[7]]]]]
```

We encourage you to try running the above functions on such a list---what error is raised?

# 7.2 Nested Lists: A Recursive Data Structure

In the previous section, we ended by articulating a fundamental limitation of our `sum_list` functions: they cannot handle heterogeneous nested lists like

```python
[[1, [2]], [[[3]]], 4, [[5, 6], [[[7]]]]]
```

In this section, we'll overcome this limitation by using a new strategy:
breaking down an object or problem into *smaller instances with the same structure as the original*.

To make this more concrete, let's first identify how the object we are working with, a nested list,
can be broken down into smaller instances with the same structure.
We will define a new structure that generalizes the idea of "list of lists of lists of ... of lists of ints".
We define a **nested list** as one of two types of values:

-   A single integer.
-   A list of other nested lists (`[lst_1, lst_2, ..., lst_n]`).
    Each `lst_i` is called a *sub-nested-list* of the outer list.

    We allow `n == 0`, which represents an *empty list*---this counts as a "nested list".

This is a **recursive definition**: it defines nested lists in terms of other nested lists.[^1]
It may seem a bit odd that we include "single integers" as nested lists; after all, `isinstance(3, list)` is False in Python!
As we'll see a few times in this chapter, it is very convenient to include this part of our recursive definition, and makes both the rest of the definition and the subsequent code we'll write much more elegant.

The *depth* of a nested list is the maximum number of times a list is nested inside other lists, including the outermost set of square brackets.
For example:

- The depth of a single integer like `10` is 0, since there are no lists.
- The depth of `[1, 2, 3]` is 1. The depth of the empty list `[]` is also 1.
- The depth of `[1, [2, [3, 4], 5], [6, 7], 8]` is 3.

## Summing up a nested list


We can use this definition to guide the design of a function that computes the sum on a nested list of numbers:

```python
def sum_nested(obj: int | list) -> int:
    """Return the sum of the numbers in a nested list <obj>.
    """
    if isinstance(obj, int):
        # obj is an integer
        return obj
    else:
        # obj is a list of nested lists: [lst_1, ..., lst_n]
        s = 0
        for sublist in obj:
            # each sublist is a nested list
            s += sum_nested(sublist)
        return s
```

This is our first example of a *recursive function*:
a function that calls itself in its body.
Just as we defined a recursive data structure---nested lists---we have now defined a recursive function that operates on nested lists.
Notice how the structure of the data informs the structure of the code: just as the definition of nested lists separates integers and lists of nested lists into two cases, so too does the function `sum_nested`.
And as the recursive part of the definition involves a list of nested lists, our code involves a loop over a list, binds `sublist` to each inner nested list one at a time, and calls `sum_nested` on it to compute the sum.

We call the case where `obj` is an integer the **base case** of the code: implementing the function's behaviour on this type of input should be very straightforward, and not involve any recursion. The other case, in which `obj` is a list, is called the **recursive case**: solving the problem in this case requires decomposing the input into smaller nested lists, and calling `sum_nested` on these individually to solve the problem.
The example above is the simplest type of recursive function, one that has just one base case and one recursive case.
Later on, we'll look at more complex recursive data structures and functions.


[^1]: Another term for "recursive definition" is *self-referential definition*.

# 7.3 Understanding Recursive Functions: Partial Tracing

We say that the call to `sum_nested` inside the `for` loop is a **recursive function call**, since it appears in the body of `sum_nested` itself.
Such function calls are handled in the same way as all other function calls in Python, but the nature of recursion means that a single initial function call often results in many different calls to the exact same function.

When thinking about a function call on a complex nested list argument, beginners will often attempt to trace through the code carefully, including tracing what happens on each recursive call. Their thoughts go something like "Well, we enter the loop and make a recursive call. That recursive call will make this other recursive call, which will make this other recursive call," and so on.
This type of literal tracing is what a computer does, but it's also *extremely time-consuming and error-prone* for humans to do.

Instead, whenever we trace a recursive function, we use the technique of **partial tracing**, which we'll describe now.
There are two cases.

## Case 1: The input corresponds to a base case

For example, suppose we want to trace the call `sum_nested(5)`.
The input `5` is an integer, the simplest kind of nested list.
In our recursive function, the `if` condition is true, and so to trace our code we can simply trace the `if` branch, completely ignoring the `else` branch.

```python
def sum_nested(obj: int | list) -> int:
    """Return the sum of the numbers in a nested list <obj>.
    """
    if isinstance(obj, int):
        # obj is an integer
        return obj
    else:
        ...
```

Tracing this is pretty easy: the line of code `return obj` simply returns the input, which was `5`.
This is the correct result: `sum_nested(5)` *should* return `5`, since the sum of a single integer is just the integer itself.


## Case 2: The input corresponds to a recursive case

For example, suppose we want to trace the call `sum_nested([1, [2, [3, 4], 5], [6, 7], 8])` and verify that the output is the correct value of 36.
For this input, the `if` condition is false,
and we need to trace the `else` branch of `sum_nested`, which is shown below:

```python
    else:
        # obj is a list of nested lists: [lst_1, ..., lst_n]
        s = 0
        for sublist in obj:
            # each sublist is a nested list
            s += sum_nested(sublist)
        return s
```

This code is an instance of the *accumulator* pattern, in which we loop over `obj`, and for each value update the accumulator variable `s`.
You've done this many times before, using ordinary loops.
But now,
at each loop iteration we make a recursive call to `sum_nested`.
Tracing this in full detail would be time-consuming and prone to eror, because
each recursive call may make its own recursive calls, as might they, and so on.
We would have to trace through all of this before finally updating the accumulator `s`.

The key idea of partial tracing is the following:
we'll trace through the code, but every time there's a recursive call,
instead of tracing into it, we *assume it is correct*, and simply use the correct return value and continue tracing the rest of our code.[^2]
Think of this as no different than tracing code that calls a built-in method, such as `list.sort`.
We don't bother tracing the call to `sort` (and how would we, since we don't have the code?).
We just assume it will work and focus on tracing our own code.

To keep track of our partial tracing, we use a *table of values*, that we build up as follows.

1.  First, we take our input `obj`, `[1, [2, [3, 4], 5], [6, 7], 8]`, and identify each sub-nested-list. Note that there are only four of them (we don't count sub-nested-lists of sub-nested-lists).

    | `sublist` |
    |---------------------|
    | `1`                 |
    | `[2, [3, 4], 5]`    |
    | `[6, 7]`            |
    | `8`                 |

2.  Next, beside each one we write down what `sum_nested` *should* return on each input. Remember that we aren't doing any tracing here; instead, we're filling this in based on the *documentation* for `sum_nested`.

    | `sublist` | `sum_nested(sublist)` |
    |---------------------|---------------------|
    | `1`                 | `1`                 |
    | `[2, [3, 4], 5]`    | `14`                |
    | `[6, 7]`            | `13`                |
    | `8`                 | `8`                 |

3.  Finally, we trace through the code from the original `else` block, updating the value of the accumulator `s` using the above table.
    We show these updates in tabular form below.

    | `sublist` | `sum_nested(sublist)` | `s` |
    |---------------------|---------------------|---------------------------------------|
    | `N/A`               | `N/A`               | `0` `(initial value)`                 |
    | `1`                 | `1`                 | `1` `(s += 1)`                                  |
    | `[2, [3, 4], 5]`    | `14`                | `15` `(s += 14)`                                 |
    | `[6, 7]`            | `13`                | `28` `(s += 13)`                                 |
    | `8`                 | `8`                 | `36` `(s += 8)`                                 |


From our table, we see that after the loop completes, the final value of `s` is `36`, and this is the value returned by our original call to `sum_nested`.
It also happens to be the correct value!

## Why does partial tracing work?

The key idea in partial tracing is to not trace into the recursive call.
Instead, we just assume it will do as promised in the docstring.
How can this make any sense?
Haven't we been learning to be skeptical about our code, and to test it thoroughly?
Let's examine this reasoning carefully, to see if it holds up.
We'll put our familiar `sum_nested` function under the microscope:

```python
def sum_nested(obj: int | list) -> int:
    """Return the sum of the numbers in a nested list <obj>.
    """
    if isinstance(obj, int):
        return obj
    else:
        s = 0
        for sublist in obj:
            s += sum_nested(sublist)
        return s
```

### Lists of depth 0

We'll start by checking whether the function works on the simplest possible input we can give it:
an integer.
What happens if we call the function with, say, `3`?
The if-condition is satisfied, and we return `3`.
That's the correct answer, according to the docstring.
So great, it works on `3`.

What about all the other integers?
Let's trace it on `0`.
The if-condition is satisfied, and we return `0`,
the correct answer.
What about `-101`?
The if-condition is satisfied, and we return `-101`.
Again, this is the correct answer.
Do you feel the need to check any more integers?
If so, go ahead.

Eventually, it should become clear that we don't need to check any more integers
because the same thing always happens:
The if-condition is satisfied, we return the integer that was passed in,
and this is the correct answer.
So we have convinced ourselves that `sum_nested` works on *any* integer,
that is, on any nested list of depth 0.
Great!

### Lists of depth 1

What about deeper lists?
Let's trace the function on a list of depth 1, say `[3, 5, 9]`.
The if-condition is *not* satisfied, so we
iterate over the sublists,
recursing on each one, and adding up the values returned.
We need to know what each recursive call will do.

- The first call is `nested_list(3)`. We already traced this, and know it will return `3`.
- The second call is `nested_list(5)`. We didn't trace this, but we already convinced ourselves that the function works on any integer, so it will return `5`.
- The third call is `nested_list(9)`, and similarly, we know it will return `9`.

The summing up will yield `17`, which is then returned. This is the correct answer.
So the function works on `[3, 5, 9]`.

What about all the other lists of depth 1?
Let's check `[10, 1, -4, 8]`.
Again, the if-condition is *not* satisfied, and we recurse on each sublist.

- The first call is `nested_list(10)`. It doesn't matter whether or not we've traced this. We convinced ourselves that the function works on any integer, so it will return `10`.
- The second call is `nested_list(1)`, and similarly, we know it will return the right answer, which is `1`.
- The third call is `nested_list(-4)`, and again, we know it will return `-4`.
- The fourth call is `nested_list(8)`, and again, we know it will return `8`.

The summing up will yield `15`, which is the correct answer.

What about some edge cases?
For a list of just one item, eg `[99]`,
if-condition is *not* satisfied but
there will be only one recursive call, on the integer `99`, which we know will correctly return `99`. The summing up will yield just that, which is the correct answer.
For an empty list,
the if-condition is *not* satisfied,
but there are no iterations and we return `0`.
Again, this is the correct answer.

Do you need to trace more examples of depth 1 lists?
Perhaps not. Perhaps you are already bored.
It should be coming clear that
every recursive call is on a list of depth 0,
and we already convinced ourselves that these always work.
And since the summing up code is correct, the final answer will be correct.
This means that `nested_sum` works on *any* list of depth 1.

### Lists of depth 2

Let's go on to check lists of depth 2, such as
`[148, [1, 2], [], 10]`.
This will cause four recursive calls:

- The first call is `nested_list(148)`. It doesn't matter whether or not we've traced this. We convinced ourselves that the function works on any list of depth 0, so it will return `148`.
- The first call is `nested_list([1, 2])`. It doesn't matter whether or not we've traced this. We convinced ourselves that the function works on any list of depth 1, so it will return `3`.
- The first call is `nested_list([])`. This is a list of depth 1, so we know it will return the correct answer, in this case, `0`.
- The first call is `nested_list(10)`. This is a list of depth 0, so we know it will return the correct answer, in this case, `10`.

The summing up will yield `161`, which is correct.

If you feel the need to trace more examples of depth 2, go ahead.
If you are getting bored again, it's probably because
a pattern is coming clear:
Every recursive call is on a list of depth either 0 or 1, and we already convinced ourselves
that these always work.
And since the summing up code is correct, the final answer will be correct.
In other words, `nested_sum` works on *any* list of depth 2.

### Lists of depth 3

Now let's look at lists of depth 3, such as
`[2, [4, 1], [[5]], 8, [1, [2], [3, 4, 5]]]`
This will cause five recursive calls:

- The first call is `nested_list(2)`. We convinced ourselves that the function works on any list of depth 0, so it will return `2`.
- The second call is `nested_list([4, 1])`. We convinced ourselves that the function works on any list of depth 1, so it will return `5`.
- The third call is `nested_list([[5]])`. We convinced ourselves that the function works on any list of depth 2, so it will return `5`.
- The fourth call is `nested_list(8)`. We convinced ourselves that the function works on any list of depth 0, so it will return `8`.
- The fifth call is `nested_list([1, [2], [3, 4, 5]])`. We convinced ourselves that the function works on any list of depth 2, so it will return `15`.

The summing up will yield `35`, which is the correct answer.
Again, there is a pattern here:
Every recursive call is on a list of depth either 0, 1 or 2 (that's all that can go into a list whose overall depth is 3!) and we already convinced ourselves
that these always work.
And since the summing up code is correct, the final answer will be correct.
In other words, `nested_sum` works on *any* list of depth 3.

### Lists of depth 4, and so on

If you are getting bored again, that's great, because there is another pattern at play here.

- If we know the function works on lists of depth up to 3, the same reasoning will allow us to conclude that it works on lists of depth 4.
- And if we know the function works on lists of depth up to 4, the same reasoning will allow us to conclude that it works on lists of depth 5.
- And so on.

We can keep applying the same reasoning as many times as we want.
In other words, for *any* depth (5, 22, 8103167 -- any depth at all),
we can continue this reasoning to show that the function works at that depth.

Or, we can skip all that, and be satisfied that the reasoning is correct and we don't have
to think through 8103166 smaller depths to believe that depth 8103167 works.
We have convincingly argued that `nested_sum` works for *any* depth greater than or equal to 0!

## So why does partial tracing work?

Returning to our original, question:
How can it make sense not to trace into the recursive calls --
to simply assume they will work?
But notice that we haven't actually assumed the recursive calls will work.
What we have done something quite different.
We constructed an argument that
*if the recursive calls do work*, the function will work.


### This is induction!

This idea is formalized in the *Principle of Mathematical Induction*, a formal proof technique that you may learn about in other courses, such as CSC165/240.
If you've already encountered induction, you might like to see
the structure of our argument expressed more formally:

Let C(n) represent the statement
"function `sum_nested` works on lists of depth n."
<!--
This way of saying it is more precise, but perhaps harder to understand
because the quantification in it is explicit, and then we are quantifying
*over* it:
"for any nested list of depth n,
function `sum_nested` returns the sum of integers in that nested list."
-->

We showed that the following are true:

1. C(0)
2. For any k >= 0, if C(i) is true for all 0 <= i <= k, then C(k+1) is true.

By the principle of induction,
we can conclude that
for all n >= 0, C(n) is true.

[^2]: In the PyCharm debugger, this is analogous to using *Step Over* rather than *Step Into* when we reach a function call.

# 7.4 Writing Recursive Functions: Using the Recursive Structure of the Problem

We've spent some time learning how to understand a recursive function using partial tracing.
Now let's think about how to write one.
The same kind of recursive thinking we used when partial tracing will serve us well.

One way to approach writing a recursive function is to start with the
recursive structure of the problem itself.
For example, consider a function that takes a nested list as input.
An arbitrarily complex nested list is made up of less complex nested lists,
and what is getting less complex (or smaller) is the depth.
You can see this visually by examining the number of nested brackets, which is
always 1 less in a sublist of a list than in the list itself.
We can solve a problem for a deeply nested lists in terms of solutions to the problem on
the less deep sublists within it.

Here is a design recipe for this approach:

1.  Identify the recursive structure of the problem, which can usually be reduced to finding the recursive structure of the *input*.
    Figure out if it's a nested list, or some other data type that can be defined recursively

    Once you do this, you can often write down a *code template* to guide the structure of your code. For example, the code template for nested lists is:

    ```python
    def f(obj: int | list) -> ...:
        if isinstance(obj, int):
            ...
        else:
            for sublist in obj:
                ... f(sublist) ...
    ```

2.  Identify and implement code for the **base case(s)**.
    Note that you can usually tell exactly what the base cases are based on the structure of the input to the function.
    For nested lists, the common base case is when the input is an integer---and if you follow the above template, you won't forget it.

3.  Write down a concrete example of the function call on an input of some complexity (e.g., a nested list of depth 3).
    Then write down the relevant recursive function calls (determined by the structure of the input), and what they output **based on the docstring of the function**.
    In other words, write down the first two columns of the table we described above in the section on partial tracing.

4.  Take your results from step 3, and figure out how to combine them to produce the correct output for the original call.
    This is usually the hardest step, but once you figure this out, you can implement the recursive step in your code!


## What about empty lists?

Here is our recursive template for nested list functions, repeated from above.

```python
def f(obj: int | list) -> ...:
    if isinstance(obj, int):
        ...
    else:
        for sublist in obj:
            ... f(sublist) ...
```

We've emphasized this structure as a way to separate the logic of the *base case* of the function, when `obj` is an integer, from the *recursive case* of the function, when `obj` is a list.
However, there is one subtlety we skipped over earlier: what happens when `obj` is an empty list?
To make this concrete, let's return to our `sum_nested` function:

```python
def sum_nested(obj: int | list) -> int:
    """Return the sum of the numbers in a nested list <obj>.
    """
    if isinstance(obj, int):
        return obj
    else:
        s = 0
        for sublist in obj:
            s += sum_nested(sublist)
        return s
```

What happens if we call `sum_nested([])`?
In this case, the if condition is `False`, we enter the else branch, which we've been calling the "recursive case" up to this point.
However, in this case because `obj` is empty, the for loop won't iterate, and so the initial value of `s`, `0`, will be returned.[^4]
No recursive calls are made, since there are no sub-nested-lists to recurse into.

Technically, this makes the empty list `[]` another *base case input* for this function.
We could write this more explicitly in our implementation of `sum_nested` as follows:

```python
def sum_nested(obj: int | list) -> int:
    """Return the sum of the numbers in a nested list <obj>.
    """
    if isinstance(obj, int):  # Base case 1: obj is an integer
        return obj
    elif obj == []:           # Base case 2: obj is an empty list
        return 0
    else:                     # Recursive step: obj is a non-empty list
        s = 0
        for sublist in obj:
            s += sum_nested(sublist)
        return s
```

You might prefer this version, because even though it's a bit longer, it is more explicit in identifying the "empty list" base case.
If so, we encourage you to use this explicit `elif obj == []` check in your own recursive functions on nested lists!

<!-- ## Nested list exercises

After you complete these nested list exercises, you should reach a point where you think that all of these questions are basically the same, because they are!
It's actually quite amazing how much the fact that the underlying input---a nested list---influences what our code looks like.

1. Compute the *depth* of a nested list, which is the maximum level of nesting in the list. An integer has depth 0.
2. Compute the number of times a number (given as a parameter) occurs within a nested list.
3. Return a list containing all the odd numbers in a nested list, in the order they appear in the list.
4. Return a list containing all the odd numbers in a nested list, in the *reverse* order they appear in the list.
5. Return all the items at a certain depth (given as a parameter) in a nested list. -->


<!--
## Some common questions

There were two common questions that came up during this week's lab. Please keep in mind that in order to use recursion in your own code, the answers to these questions are irrelevant; you can *reason* about your recursive code by following the method described above, without actually knowing any implementation details.

But in terms of implementation, there is one overriding principle: recursive function calls behave *exactly the same* as any other function calls. So if you're ever asking a question about how recursion works under the hood, try asking the equivalent question replacing the recursive call with a call to some other helper function, and see if you know the answer.

### Why do we need a return in the recursive step?

The question is, since the recursive step triggers a recursive call, which will trigger another recursive call, etc., all the way until reaching the base case, then why can't we rely on the base case returning the correct value, and omit any `return` statements in the recursive step?

```python
def sum_nested(obj):
    if isinstance(obj, int):
        return obj
    else:
        s = 0
        for sublist in obj:
            s = s + sum_nested(sublist)
        # omit return?
        s
```

The answer to this question lies not in the behaviour of recursive functions, but in the behaviour of `return` statements and functions. Consider this (example:

```python
def f():
    return 5

def g():
    f()
```

What happens when we call `g`?

1. `g` calls `f`
2. `f` returns 5 to `g`
3. `g` takes the 5 and... stops.

In other words, `g` returns `None`, not 5! And this is true *regardless of the body of* `f`; it completely depends on the *lack* of `return` in `g`.

The same is true of recursive functions: without even looking carefully inside the `for` loop, we can determine that the recursive step will always return `None`, because it doesn't use `return` anywhere! So the moral of the story is that any time you want a function or method to return something, you must use the keyword `return`.

### Do recursive calls overwrite local variables?

Our code for `sum_nested` uses local variable `s` to accumulate the nested sums of each inner nested list. But each time we make a recursive call, the line `s = 0` executes; why doesn't the local variable `s` get overwritten in each recursive call?

This is one of the fundamental features of functions in almost all programming languages: every *function call* has its own namespace of local variables. In other words, every time you make a function call, it gets its own "set" of local variables, which cannot be influenced by any other function call.
This is true when one function calls another:

```python
def f():
    x = 5

def g():
    x = 100
    f()
    return x  # Returns 100
```

It is just as true when a function calls itself. So in fact multiple recursive calls never "overwrite" local variables, because each call has its own local variables that are independent from all other calls.

## Warning about recursive calls

Finally, we return to the "fundamental assumption" we made when reasoning about recursive code: that every recursive call always works properly. This is a powerful assumption because it greatly simplifies how we can trace our code, but it does come with one caveat.

**We can only assume a recursive call is correct when the argument is "smaller" than the original input to the function.** What do we mean by smaller? This depends on the type of input, but generally we mean "structurally closer to the base case." For example, in nested lists the base cases are the integers, i.e., nested lists of depth 0. In our recursive calls, each `sublist` has a smaller depth than the original list, and here "smaller depth" is our indication that these recursive calls are made on smaller inputs.

Here is an example of a bad recursive call, where the depth might actually stay the same between the original input and the input to the recursive call:

```python
def sum_nested(obj):
    if isinstance(obj, int):
        return obj
    else:
        s = 0
        for sublist in obj:
            s = s + sum_nested([sublist, 1])
        return s
```

In the recursive call, the input might look "smaller" than the original.
After all, it contains only one element of obj with the number 1 added in.
But the base case we are working towards occurs when obj is simply an int,
and we can progress towards it by reducing the *depth* of the list on every call.
In the above version of the function, we don't reduce the depth at all.
For instance, if `obj` is a list of depth 2 such as `[[10, 20, 30], [2, 4], 88]`,
on the first iteration of the loop `sublist` is `[10, 20, 30]`
and so the argument passed in the recursive call is `[[10, 20, 30], 1]`.
This is also a list of depth 2.  We have not progressed towards the base case.
As a result,
calling this version of the function results in *infinite recursion*,
which actually gives us a special runtime error in Python:

```python
>>> sum_nested([1, 2, 3])
RuntimeError: maximum recursion depth exceeded while calling a Python object
```

We'll talk more about this error later in the course, but for now keep in mind that the "size" of the inputs to recursive calls must always be smaller than the original!

This is one reason we placed such a big emphasis on identifying the recursive structure of the input and problem: if you do so, and respect that structure in your recursive calls, you are almost guaranteed to avoid this problem. This is true for not just nested lists, but also the recursive linked list implementation you saw in Lab 5, and the new recursive data structure we'll see next week.

-->

## What if the problem lacks a recursive structure?

Later on, we'll learn some other structures that can be defined recursively, and each
will have its own code template.
These templates can be really helpful in solving recursive problems.

An interesting challenge arises when we need to solve a problem that does not come
with a recursive structure.
Here's an example:

```python
def buyable(n: int) -> bool:
    """Return whether one can buy exactly <n> McNuggets.

    McNuggets come in boxes of 4, 6, and 25. It is considered possible
    to buy exactly 0 McNuggets.

    Precondition: n >= 0
    """
```

The input to this function is an integer.
Unlike nested lists,
integers do not have an obvious recursive structure, and so we need to do additional problem-solving to find a recursive solutions to this function.
One such technique is to generate test scenarios, which is described in the next section.



[^4]: The return value of 0 may seem a bit strange. This is because it is often mathematically useful to define the sum of an empty sequence to be zero. Python's built-in `sum` function returns 0 on an empty list---try it!

# 7.5 Writing Recursive Functions: Using a Set of Test Scenarios

A variation on the approach we just saw is to
think in terms of a set of scenarios.
We'll record these in a table, with one row for each scenario,
as you would if you were designing a test suite.
Ultimately, we will think through a thorough set of scenarios,
but we can start with just those that are suggested by
the recursive structure of the problem.

Here is our design recipe:

1. Create one row in the table for each scenario suggested by the recursive structure of the problem. <!-- For example, consider a nested list. Since is either a simple integer or a list containing nested sublists (by definition), these are our first two scenarios for the table. -->
2. For each case that is so simple that no recursion is called for, write down what the function should do (what it should return and/or mutate).
3. For each case that is complex enough that one or more recursive calls will help:
   - Write down what recursive call(s) should be made, and **use the docstring of the function** to determine what each will do (what it will return and/or mutate).
   - Write down what the present call needs to do with those results to accomplish its goal.
4. Add to the table any other scenario(s) that you feel are important to think through, along with a concrete example. For each,
	- If it can be handled using the strategy of any previous scenario, record that fact. We won't need code for this specific case!
	- If not, handle the novel scenario as per steps (2) and (3) above.

<!--
1. Think through all possible inputs to the function and identify interesting cases, just as you would if you were designing a test suite.
2. For each case that is so simple that no recursion is called for, write down what the function should do (what it should return and/or mutate).
3. For each case that is complex enough that one or more recursive calls will help:
   1. Write down a concrete example of the input to the function.
   2. Write down what recursive call(s) will be made, and **use the docstring of the function** to determine what each will do (what it will return and/or mutate).
   3. Write down what the present call needs to do with those results to accomplish its goal.
4.
5. Review the cases to see if they can be collapsed. Sometimes two cases are handled by doing the same thing.

One way to record the analysis is in a three-column table with
one row per case.
The first column shows the case with a concrete example,
the second column shows the recursive calls needed for that case
(as well as the result of each),
and the third column shows what the present call must do.
-->

As an example, suppose we want to design this function:
```python
def flatten(obj: int | list) -> list[int]:
    """Return a (non-nested) list of the integers in <obj>.

    The integers are returned in the left-to-right order they appear
    in <obj>.
    """
```

As suggested by the recursive structure of a nested list,
our first two scenarios are
a simple integer and a list containing nested sublists.
We pick an arbitrary example of each:

<img src="images/F1-crop.jpg" alt="three-column table" width="600"/>

In scenario 1, the problem is so easy that
we don't need any "help" from a recursive call. We can simply put the given integer into
a list and return that.
It's easy to see that this strategy would work for any integer.
We record this strategy in the table:

<img src="images/F2-crop.jpg" alt="three-column table" width="600"/>

For scenario 2, we have chosen an non-trivial example of a list input.
This will help us to ensure our solution in this case is as general as possible,
in other words,
that it will handle lots of different list inputs.
First, we write down the recursive call(s) that should be made.
Since this is a list of nested lists,
all of which could contribute to the result for `flatten`,
we will need to recurse on each of them.
Then we **use the docstring of the function** to determine what each will do
(what it will return and/or mutate).
We record this in the middle column of the table:

<img src="images/F3-crop.jpg" alt="three-column table" width="600"/>

Assuming each recursive call works properly,
what does *our* call have to do in order to return the correct answer?
It's fairly easy to see that we need to put those individual results together into a
single list and return it.
We can start out with an empty list, and after each recursive call, add in its result.
(We'll need to think about whether `append` or `extend` is the right list method to use, but
that is a minor detail.)
We record this in the third column:

<img src="images/F4-crop.jpg" alt="three-column table" width="600"/>

We might think of a couple of additional scenarios, as shown here:

<img src="images/F5-crop.jpg" alt="three-column table" width="600"/>

The empty list, however, is already handled by our solution to scenario 2.
In this case, we'll start with an empty list, iterate 0 times, and
return that empty list---which is correct!
Thinking through an example of a list of integers,
we can see that this is also already handled by scenario 2!
Here is our complete table of scenarios, with these observations included:

<img src="images/F6-crop.jpg" alt="three-column table" width="600"/>



<!--
We might come up with this analysis:
<img src="images/table.jpg" alt="three-column table" width="600"/>

In scenario 1, the input is an integer. This instance of the problem is so easy that
we don't need any "help" from a recursive call. We can simply put the given integer into
a list and return that.
It's easy to see that this strategy would work for any integer.

In scenario 2, we begin to consider a list input, and we start with the simplest possible list:
an empty list.
Here again, the problem is so easy that we don't need to make any recursive calls.
There *are* no integers in this nested list,
so we can simply return the empty list.

In scenario 3, we consider a list that is 1 level deeper.
The example list we chose has 3 items.
We can see that each item is simply an integer, but the code we write won't "know" that
unless it checks.
We could iterate through the list and check each item to see if it is an integer,
but then what if some of them are and some of them aren't?
This is getting complicated, so let's see if we can bring in recursion to make our work easier!
We can ask ourselves:

- What recursive call(s) could we make on simpler instances of this problem?
- Can we use their results to solve our problem?

We could recurse on each item in the list.
And let's use partial tracing
to save the effort of thinking about how the recursive calls will work, since
all we need to know is what they'll do if they work correctly.
In the middle column of the table,
we've written
the argument we'll pass to each recursive call, and
what the function will return in each case.
Assuming that happens, what does *our* call have to do in order to return the correct answer?
It's fairly easy to see that we need to put those individual results together into a
single list and return it.
We can start out with an empty list, and after each recursive call, add in its result.
(We'll need to think about whether `append` or `extend` is the right list method to use, but
that is a minor detail.)

In scenario 4, we consider a deeper list.
Again, we wrote in the middle column the recursive calls and what they'll return
(assuming they work correctly).
The steps we laid out for scenario 3 will handle scenario 4 too!
So we can collaps these two scenarios into one branch of code.

Looking back at the other rows, you may notice that these same steps will also work
for scenario 2: In this case, we'll start with an empty list, iterate 0 times, and
return that empty list -- which is correct.
We can't, however, use those steps to handle scenario 1:
if we are passed an integer, attempting to iterate over it will generate an error.

Notice that the effort to write this table is not very great.
It requires thinking about scenarios, which you are used to from learning how to test code.
(And you can re-use these scenarios when writing your test suite.)
It requires using the same kind of recursive thinking that you have become used to
from doing partial tracing.
We also used some simple reasoning to collapse cases.
That last step isn't strictly necessary in order to get a working recursive function,
but it does produce simpler code, which is always preferable.
-->


When we translate our analysis into code,
we'll only need to implement the first two rows.
With all of our previous work, doing so is quite simple:

```python
def flatten(obj: Union[int, list]) -> List[int]:
    """Return a (non-nested) list of the integers in <obj>.

    The integers are returned in the left-to-right order they appear
    in <obj>.
    """
    if isinstance(obj, int):
        return [obj]
    else:
        s = []
        for sublist in obj:
            s.extend(flatten(sublist))
        return s

```

Then to test our code,
we can take advantage of all four scenarios
to check that our function works correctly.
If our reasoning was correct, all tests *will* pass successfully.
The purpose of testing them anyway is to check that reasoning!
Here we can see that our function indeed works correctly in all four scenarios:

```python
>>> flatten(6)
[6]
>>> flatten([[0, -1], -2, [[-3, [-5]], 4]])
[0, -1, -2, -3, -5, 4]
>>> flatten([])
[]
>>> flatten([8, 13, -2])
[8, 13, -2]
```

An interesting question is how we should record these tests.
Should they be doctests or unit tests run with pytest?
Remembering that the purpose of doctests is to communicate to the reader
what the correct behaviour of the function looks like,
we might put only the first two scenarios into doctests.
The rest are better suited to unit tests in a separate file, where we do our most thorough testing.
# 7.6 How Recursive Code Can Fail

If you have a recursive function and it's *incorrect* (say, failing a test case that you wrote), there can only be one of the following problems:

1.  A base case is incorrect.
1.  A recursive case is incorrect, *even if you assume* that every recursive call is correct!
    In other words, the problem isn't in the recursive call itself, it's in the code surrounding that recursive call.
1.  One or more of the recursive calls is being made on an input that is *not* smaller.
1.  Each recursive call is indeed on a smaller input, but we don't successfully connect to a base case.

The first two types of problem are regular bugs, while the other two involve the structure
of the recursion.
Let's look at an example of each.

## Incorrect base case

Here's a variation on our `sum_nested` function where the base case is incorrect:

```python
def sum_nested(obj: int | list) -> int:
    if isinstance(obj, int):
        return 0
    else:
        s = 0
        for sublist in obj:
            s += sum_nested(sublist)
        return s
```
Try partial tracing this function on the list `[1, [2, [3, 4], 5], [6, 7], 8]`.
It will tell you that the correct answer, 36, is returned.
But if we run that example, we do not get 36!
What's going on?
When we do partial tracing, we aren't checking whether the function works
on that case;
we are checking whether it works on that case *assuming it works on smaller cases*.
And that assumption does not hold here.
This function returns the wrong answer when given any nested list that is
simply an integer (except it works on the integer 0).^[
    Can you figure out what this function will return when called on the list
    `[1, [2, [3, 4], 5], [6, 7], 8]`, without tracing it or running it?
    Hint: look at all the places where an integer is used:
    how they are initialized, added to, and returned.
    What will be the net effect of doing any number of those operations?
]

## Incorrect recursive case

Here's a function whose job is to return the maximum value in a nested list:

```python
def biggest_nested(obj: int | list) -> int:
    """Return the biggest number in a nested list <obj>.

    >>> lst = [1, [2, [33, 4], 5], [66, 7], 8]
    >>> biggest_nested(lst)
    66
    """
    if isinstance(obj, int):
        return obj
    else:
        biggest = 0
        for sublist in obj:
            b = biggest_nested(sublist)
            if b > biggest:
                biggest = b
    return biggest
```
The base case is correct,
but the recursive case doesn't (always) work, even if every recursive call does
what it's supposed to.
There is a simple logic error that has nothing to do with recursion.
Can you come up with a test case that this function will fail?

## Input not getting smaller

So far, the kinds of errors we've looked at don't really have to do with the recursion.
But there are two kinds of errors that are all about the structure of the recursive calls.
One structural problem occurs when a recursive call is made on an input that is not smaller.

Here's an example where the code is obviously wrong:

```python
def sum_nested(obj: int | list) -> int:
    if isinstance(obj, int):
        return obj
    else:
        s = 0
        s += sum_nested(obj)
        return s
```
Since we are not recursing on each sublist, this can't work.
But the problem is worse than that:
The one recursive call we do make is on the same list we were given.
This is clearly not any smaller.
Of course, that call will do the same thing,
and the recursive call *it* makes will do the same thing,
and so on forever.
We will never reach the base case, and so we end up with infinite recursion.
We say "forever", but since Python uses the call stack to record every function call,
we will have an ever-growing call stack.
And memory is finite, so Python will eventually stop our code,
raising this error:
`RecursionError: maximum recursion depth exceeded in comparison`.

This example was a little silly, since you could easily see that the code was wrong.
But infinite recursion can be much trickier to spot.
Consider this version of `sum_nested`:

```python
def sum_nested(obj):
    if isinstance(obj, int):
        return obj
    else:
        s = 0
        for sublist in obj:
            s = s + sum_nested([sublist, 1])
        return s
```

In the recursive call, the input looks "smaller" than the original.
After all, it contains only one element of obj with the number 1 added in.
But the base case we are working towards occurs when obj is simply an int,
and we can only progress towards it by reducing the *depth* of the list on every call.
In the above version of the function, we don't reduce the depth at all.
For instance, if `obj` is a list of depth 2 such as `[[10, 20, 30], [2, 4], 88]`,
on the first iteration of the loop `sublist` is `[10, 20, 30]`
and so the argument passed in the recursive call is `[[10, 20, 30], 1]`.
This is also a list of depth 2.  We have not progressed towards the base case,
so we ultimately will get the error
`RecursionError: maximum recursion depth exceeded in comparison`.

<!-- A much more subtle example of the problem size not getting smaller:
Try to find the problem in this version of a recursive binary search function:
```python
def bsearch(lst: list[int], i: int, j: int, item: int) -> bool:
    """Return True iff item occurs in lst[i:j].

    Precondition: i <= j.

    >>> lst = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    >>> bsearch(lst, 0, 10, 7)
    True
    """
    if i == j:
        # Searching an empty sublist, so item cannot be there.
        return False
    else:
        mid = (i + j) // 2
        if item < lst[mid]:
            # Go to the LHS. No need to include lst[mid] because item is less.
            return bsearch(lst, i, mid, item)
        else:
            # To to the RHS.  Include lst[mid] because item is >= lst[mid].
            return bsearch(lst, mid, j, item)
```
-->

## Not connecting to the base case

A final structural problem occurs when
the recursive calls never connect to any base case.
This function suffers from that problem:
```python
def f(n: int) -> int:
    """
    Precondition: n >= 0.
    """
    if n == 0:
        return 1
    else:
        return n + f(n - 2)
```
In this case, the input is an integer, and it does get smaller on each recursive call.
But it gets smaller by 2, and this means there are two scenarios that can crop up:
if we call the function with an even number,
each recursive call will also be a (smaller) even number,
and eventually we will call the function on 0.
That call will invoke the base case and not recurse further.
So the original function call will ultimately terminate.
(Whether or not the return value is correct is a separate matter.)
But if we call this function with an odd number,
we will never reach 0.
Instead we will recurse on a (smaller) odd number,
and so on,
ultimately reaching a call with 1 as the argument.
And here's where we get into trouble:
that call will recurse on `f(-1)`.
Of course, that call will recurse on `f(-3)`.
You can see that this will lead to recursion that only ends when
the call stack runs out of space and Python raises the error:
`RecursionError: maximum recursion depth exceeded in comparison`

To ensure that this code always terminates properly, we must have two base cases:
one reached when we start with an even input, and one reached when we start with an odd input.
Here's a version of the function that does terminate properly
(we aren't concerned here with what the function computes):
```python
def f(n: int) -> int:
    if n == 0:
        return 1
    elif n == 1:  # Adding this clause fixes the problem
        return 1
    else:
        return n + f(n - 2)
```

<!--
Notice that if the problem size went down by 3 on each recursive call,
we'd need 3 base cases.
-->

With these categories of error in mind,
let's think about how to test and debug recursive code.


## Testing and debugging recursive code

Start by running tests for scenarios that invoke the base case(s).
If they don't work, the recursive steps certainly won't!
Once your code for the base case(s) are working,
move on to more complex scenarios.

If you encounter a bug,
go back to your analysis and make sure it is correct.
If you believe it is,
then trace your method or function on each of the scenarios in your table,
being sure to use partial tracing.
(You can do your tracing on paper or in the debugger.
If tracing in the debugger,
use "step over" to get past a recursive call
without going into the details of that call.)
Keep in mind the error message you got and the line that raised it.
Often, knowing the specific error message,
plus considering the possible scenarios that could have landed you on that line,
is enough to figure out how that error could have occurred.


<!-- ## Nested list exercises

After you complete these nested list exercises, you should reach a point where you think that all of these questions are basically the same, because they are!
It's actually quite amazing how much the fact that the underlying input---a nested list---influences what our code looks like.

1. Compute the *depth* of a nested list, which is the maximum level of nesting in the list. An integer has depth 0.
2. Compute the number of times a number (given as a parameter) occurs within a nested list.
3. Return a list containing all the odd numbers in a nested list, in the order they appear in the list.
4. Return a list containing all the odd numbers in a nested list, in the *reverse* order they appear in the list.
5. Return all the items at a certain depth (given as a parameter) in a nested list. -->


<!--
## Some common questions

There were two common questions that came up during this week's lab. Please keep in mind that in order to use recursion in your own code, the answers to these questions are irrelevant; you can *reason* about your recursive code by following the method described above, without actually knowing any implementation details.

But in terms of implementation, there is one overriding principle: recursive function calls behave *exactly the same* as any other function calls. So if you're ever asking a question about how recursion works under the hood, try asking the equivalent question replacing the recursive call with a call to some other helper function, and see if you know the answer.

### Why do we need a return in the recursive step?

The question is, since the recursive step triggers a recursive call, which will trigger another recursive call, etc., all the way until reaching the base case, then why can't we rely on the base case returning the correct value, and omit any `return` statements in the recursive step?

```python
def sum_nested(obj):
    if isinstance(obj, int):
        return obj
    else:
        s = 0
        for sublist in obj:
            s = s + sum_nested(sublist)
        # omit return?
        s
```

The answer to this question lies not in the behaviour of recursive functions, but in the behaviour of `return` statements and functions. Consider this (example:

```python
def f():
    return 5

def g():
    f()
```

What happens when we call `g`?

1. `g` calls `f`
2. `f` returns 5 to `g`
3. `g` takes the 5 and... stops.

In other words, `g` returns `None`, not 5! And this is true *regardless of the body of* `f`; it completely depends on the *lack* of `return` in `g`.

The same is true of recursive functions: without even looking carefully inside the `for` loop, we can determine that the recursive step will always return `None`, because it doesn't use `return` anywhere! So the moral of the story is that any time you want a function or method to return something, you must use the keyword `return`.

### Do recursive calls overwrite local variables?

Our code for `sum_nested` uses local variable `s` to accumulate the nested sums of each inner nested list. But each time we make a recursive call, the line `s = 0` executes; why doesn't the local variable `s` get overwritten in each recursive call?

This is one of the fundamental features of functions in almost all programming languages: every *function call* has its own namespace of local variables. In other words, every time you make a function call, it gets its own "set" of local variables, which cannot be influenced by any other function call.
This is true when one function calls another:

```python
def f():
    x = 5

def g():
    x = 100
    f()
    return x  # Returns 100
```

It is just as true when a function calls itself. So in fact multiple recursive calls never "overwrite" local variables, because each call has its own local variables that are independent from all other calls.

## Warning about recursive calls

Finally, we return to the "fundamental assumption" we made when reasoning about recursive code: that every recursive call always works properly. This is a powerful assumption because it greatly simplifies how we can trace our code, but it does come with one caveat.

**We can only assume a recursive call is correct when the argument is "smaller" than the original input to the function.** What do we mean by smaller? This depends on the type of input, but generally we mean "structurally closer to the base case." For example, in nested lists the base cases are the integers, i.e., nested lists of depth 0. In our recursive calls, each `sublist` has a smaller depth than the original list, and here "smaller depth" is our indication that these recursive calls are made on smaller inputs.

Here is an example of a bad recursive call, where the depth might actually stay the same between the original input and the input to the recursive call:

```python
def sum_nested(obj):
    if isinstance(obj, int):
        return obj
    else:
        s = 0
        for sublist in obj:
            s = s + sum_nested([sublist, 1])
        return s
```

In the recursive call, the input might look "smaller" than the original.
After all, it contains only one element of obj with the number 1 added in.
But the base case we are working towards occurs when obj is simply an int,
and we can progress towards it by reducing the *depth* of the list on every call.
In the above version of the function, we don't reduce the depth at all.
For instance, if `obj` is a list of depth 2 such as `[[10, 20, 30], [2, 4], 88]`,
on the first iteration of the loop `sublist` is `[10, 20, 30]`
and so the argument passed in the recursive call is `[[10, 20, 30], 1]`.
This is also a list of depth 2.  We have not progressed towards the base case.
As a result,
calling this version of the function results in *infinite recursion*,
which actually gives us a special runtime error in Python:

```python
>>> sum_nested([1, 2, 3])
RuntimeError: maximum recursion depth exceeded while calling a Python object
```

We'll talk more about this error later in the course, but for now keep in mind that the "size" of the inputs to recursive calls must always be smaller than the original!

This is one reason we placed such a big emphasis on identifying the recursive structure of the input and problem: if you do so, and respect that structure in your recursive calls, you are almost guaranteed to avoid this problem. This is true for not just nested lists, but also the recursive linked list implementation you saw in Lab 5, and the new recursive data structure we'll see next week.

-->

# 7.7 Recursion and the call stack

The key to partial tracing is that we don't trace into the recursive calls.
We've learned that we don't *have* to, 
because an inductive argument demonstrates that partial tracing is sufficient.
But when your code is actually run, 
each recursive call (like all calls) creates a stack frame that is pushed.
And each return (like all returns) pops the top stack frame.
Of course one recursive call may make other recursive calls, and they may do the same.
Python keeps track of all of this on the call stack.

Let's do one small example to see what Python takes care of for us.
Rather than look at our old favourite, `sum_nested`, let's start with something even simpler:

```python
def sum_ordinary(lst: list[int]) -> int:
    """Return the sum of the numbers in ordinary (non-nested) list <lst>.

    >>> sum_ordinary([])
    0
    >>> sum_ordinary([5, 1, 3, 9])
    18
    """
    if len(lst) == 0:
        return 0
    else:
        sum_of_rest = sum_ordinary(lst[1:])
        total = lst[0] + sum_of_rest
        return total
```

This is a function we don't need to write 
because the built-in `sum` function does the same thing,
but it is a good example to illustrate 
how the call stack works with a recursive function.
You'll notice that 
we have split what could easily be a one-line else-block into three lines.
This also is for illustrative purposes.

Now watch this video to see how the recursion unfolds.

<video width="640" height="480" controls>
	<source src="https://www.teach.cs.toronto.edu/~csc148h/notes/trace.mp4" type="video/mp4" />	 
	<p>
	Your browser doesn't support HTML video. Here is a
	<a href="trace.mp4" download="trace.mp4"> link to the video</a> instead.
	</p>
</video>

For a list of length 4, a total of 5 calls to the function are made: 
the initial call with the list of length 4, 
a call with a list of length 3, 
one with a list of length 2, 
one with a list of length 1, and, finally,
one with a list of length 0. 
So 5 stack frames are generated in total, 
plus one for the main block where everything started.
We confirmed this in the video, 
when we saw that the stack peaked in size the moment it had those 6 frames.

There's one interesting detail that the debugger doesn't highlight.
The argument to the recursive call is not made by mutating `lst`.
Instead, our function uses the slice operator.
Recall that slicing always creates a new list object.
And that new list is a "shallow copy" of the old list: 
it's a new list, but it contains the same ids (for whichever list elements we kept when slicing)
as in the old list.
We don't get new copies of the objects that the ids refer to.

So: every time `sum_ordinary` recurses, a new list object is created.
Here's how it looks in the memory model
when we reach the call to `sum_ordinary` with a list of length 0 (the empty list):

<img src="images/tracing/mm_fullstack.jpg" alt="Memory model diagram of the call stack at its peak" width="800"/>

(We chose id values that are conveniently the same as the ints they refer to.)

For comparison, here's what the debugger shows us at the same moment:

<img src="images/tracing/t10.png" alt="What the debugger shows when the call stack at its peak" width="800"/>

We see the stack frames on the left, and the variables that exist in the top stack frame
(the one we are currently executing) on the right,
in this case, the parameter `lst` which currently is an empty list.
As we saw in the video, we can click on any of the other stack frames to see their variables.
Here's we've clicked several frames down in the stack,
when `lst` had three elements:

<img src="images/tracing/peek.png" alt="What the debugger shows when the call stack at its peak" width="800"/>

You could believe that there is one variable called `lst` that is changing.
But there is not just one!
Every call to `sum_ordinary` has its own parameter `lst` sitting inside its own stack frame,
as we see in the full memory model diagram above.
At that moment in time, there are five different variables called `lst` on the call stack.


## Linear recursion

Notice that, with function `sum_ordinary`,
a call to the function either doesn't recurse at all or 
makes a single recursive call.
This is called **linear recursion**,
because it leads to a linear sequence of recursive calls
(and a fairly simple set of actions on the call stack).

Recursive code that is linear can usually be translated into iterative code
that is no more complicated.
For example, we can rewrite `sum_ordinary` with a very simple loop:

```python
def sum_ordinary(lst: list[int]) -> int:
    """Return the sum of the numbers in ordinary (non-nested) list <lst>.

    >>> sum_ordinary([])
    0
    >>> sum_ordinary([5, 1, 3, 9])
    18
    """
    total = 0
    for item in lst:
        total += item
    return total
```

If this was the whole story of recursion, 
there wouldn't be much motivation for learning it.
But when we get beyond linear recursion, 
we can write elegant code that does *not* have an iterative equivalent that is as simple.

# 7.8 Branching recursion

When we taught you recursion, 
we started with `sum_nested`:

```python
def sum_nested(obj: int | list) -> int:
    """Return the sum of the numbers in a nested list <obj>.
    """
    if isinstance(obj, int):
        # obj is an integer
        return obj
    else:
        # obj is a list of nested lists: [lst_1, ..., lst_n]
        s = 0
        for sublist in obj:
            # each sublist is a nested list
            s += sum_nested(sublist)
        return s
```

`sum_nested` is different from `sum_ordinary` in a very important way:
A call to this function either doesn't recurse or 
recurses not once, but n times, where n is `len(obj)`.
And each of *these* calls 
either doesn't recurse or recurses potentially several times.
And so on and so on.
We call this **branching recursion** because
we end up with a branching set of function calls.
We can represent this with a branching diagram.
For example, suppose we have a main block that calls
`sum_nested([6, [1, [2, 4], [3]], [], [8]])`.
This ultimately leads to all the function calls shown in the diagram below, where
an arrow from A to B means that function call A leads to function call B.

<img src="images/tracing/call_tree.jpg" alt="All the calls made to sum_nested as a result of an initial call to sum_nested([6, [1, [2, 4], [3]], [], [8]])" width="800"/>


Because of the branching calls, 
the set of actions that occurs on the call stack in this case
is much more complicated than what we saw with `sum_ordinary`.
Try to answer these questions:

1. How many frames are on the stack when we are processing the call to `sum_nested(6)` (including the stack frame for that call)?
1. How many frames are on the stack when we are processing the call to `sum_nested([8])` (including the stack frame for that call)?
1. How many frames are on the stack when we are processing the call to `sum_nested([2, 4])` (including the stack frame for that call)?
1. How many frames are on the call stack when it reaches its tallest?

Can you picture exactly all the pushing and popping that must go on 
to execute this simple call to `sum_nested([6, [1, [2, 4], [3]], [], [8]])`?
Python is infinitely "patient" and happily works away on this.
But for people, it's hard to hold in our head,
and it can be much more complex when the function call isn't so trivial.
We could trace carefully on paper, working away on the pushing and popping just as Python does,
but that is a lot of work.
Luckily, we know that we don't have to because partial tracing, although much simpler, works.

This is why partial tracing is so great!