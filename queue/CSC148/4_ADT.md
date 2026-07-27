# 4.1 Introduction to Abstract Data Types

In the first few weeks of the course, we have mainly played the role of the *class
designer and implementer*.
However, you have actually spent most of your programming career in the
opposite role: whenever you use one of Python's built-in functions or data structures, you only worry about what it does, not how it works.
In other words, you are a *client* of the built-in Python libraries and classes.

Some concepts are so general and so useful across many problems that they transcend any specific programming language.
An **abstract data type** (or ADT)
defines some kind of data and the operations that can be performed on it.
It is a pure interface,
with no mention of an implementation---that's what makes it *abstract*.
<!-- David -->
In contrast to this, a **data structure**
is a concrete strategy for storing some data.
For example, one data structure we could use to store the grades of a class on a series of course activities
is a list of lists:

```python
grades = [['Sadia', 78, 82],
          ['Yuan', 75, 64],
          ['Elise', 80, 71]]
# To know what the "columns" are for,
# we could use another list:
items = ['A1', 'midterm']
```

An alternative data structure is a dictionary of dictionaries:
```Python
g2 = {'A1': {'Sadia': 78, 'Yuan': 75, 'Elise': 80},
      'midterm': {'Sadia': 82, 'Yuan': 64, 'Elise': 71}}
```

You can very likely think of other options, and may find it interesting
to consider pros and cons of the two data structures above.
But the point here is that
ADTs are fundamentally concerned with the *what*: what data is stored, and what we can do with this data.
Data structures are concerned with the *how*: how is that data stored, and how do we actually implement our desired methods to operate on this data?
This distinction is crucial to the kind of abstract thinking you'll develop as programmers: by separating the *what* from the *how*,
you'll gain substantial benefits,
as we are about to learn.

## Some famous abstract data types

In this section, we'll briefly describe some of the most common abstract data types in computer science.
Now, while computer scientists generally agree on what the "main" abstract data types are, they often disagree on what operations each one actually supports.
You'll notice here that we've taken a fairly conservative approach for specifying operations, limiting ourselves to the most basic ones.

-   **Set**

    -   Data: a collection of unique elements
    -   Operations: get size, insert a value (without introducing duplicates), remove a specified value, check membership

-   **Multiset**

    -   Data: a collection of elements (possibly with duplicates)
    -   Operations: same as Set, but the insert operation allows duplicates

-   **List**

    -   Data: an ordered sequence of elements
    -   Operations: access element by index, insert a value at a given index, remove a value at a given index

-   **Map**

    -   Data: a collection of key-value pairs, where each key is unique and associated with a single value
    -   Operations: lookup a value for a given key, insert a new key-value pair, remove a key-value pair, update the value associated with a given key

-   **Iterable**

    -   Data: a collection of values (may or may not be unique)
    -   Operations:
        iterate through the elements of the collection one at a time.

Many of these will sound familiar, as you'll have used them in your past programming experience, even if you haven't heard the term "abstract data type" before!
For example, you have probably used both a Python `list` and `dict`.
However, there is a really important distinction between Python's built-in classes and the ADTs we've listed above:
`list` and `dict` are data structures, *not* abstract data types.
That is, they're concrete implementations, and every necessary decision about *how* these classes store their data and implement their methods has been made.
Indeed, the designers of the Python programming language put a great deal of effort into
these implementations so that `list` and `dict` operations are extremely fast.

So a `dict`, for instance, is not itself an ADT.
But it is fair to say that a `dict` is a natural implementation of the Map ADT.
However,
*there is NOT a one-to-one correspondence between ADTs and data structures*,
in Python or any other language.

A single ADT can be implemented by many different data structures.
For example, although the Python `list` is a natural implementation of the List ADT, we could implement it instead with a `dict` in which each key is the index of its item.
A list of 3 elements, `hello`, 42, and `goodbye` in positions 0, 1, and 2 respectively, would be

```python
{0: 'hello', 1: 42, 2: 'goodbye'}
```

On the flip side, each data structure can be used to implement multiple ADTs.
The Python `list` can be used to implement not just the List ADT, but each of the other above ADTs as well.
For instance, think about how you would implement the Set ADT with a `list`, and in particular, how you would avoid duplicates.[^1]
A `dict` could also implement any of the ADTs above, and the same is true of the new data structures you will learn in this course.


## The value of knowing all the standard ADTs

We've said that each ADT is so general that it transcends any individual problem or program or even programming language.
And in fact the ADTs given above are implemented in other programming languages (to varying degrees).
While the exact data structures used to implement them vary significantly from language to language,
these ADTs concepts form a common vocabulary whose understanding is necessary to being a professional computer scientist.

[^1]: Beginning Python programmers often implement the Set ADT with a `list`, but Python has a built-in `set` class that implements the Set ADT, does all the work of duplicate-avoidance for you, and does it very efficiently.
# 4.2 Stacks and Queues

To round out our study of ADTs, we'll learn about two new ADTs this week: the Stack and the Queue.
Both of these ADTs store a collection of items, and support operations to add an item and remove an item.
However, unlike a Set or Multiset, in which the client code may specify which item to remove,
Stacks and Queues remove and return their items in a fixed order---client code is allowed no choice.
This might seem very restrictive and simplistic, but you'll soon learn how the power of these ADTs lies in their simplicity.
Once you learn about them, you'll start seeing them everywhere, and be able to effectively communicate about these ADTs to any other computer scientist.


## The Stack ADT

The **Stack** ADT is very simple.
A stack contains zero or more items.
When you add an item, it goes "on the top" of the stack (we call this "pushing" onto the stack) and when you remove an item, it is removed from the top also (we call this "popping" from the stack).[^1]
The net effect is that the first item removed from the stack is the last item that was added.
We call this Last-In-First-Out (or LIFO) behaviour.
To summarize:

-   **Stack**

    -    Data: a collection of items
    -    Operations: determine whether the stack is empty, add an item (*push*), remove the most recently-added item (*pop*)

In code:

```python
class Stack:
    """A last-in-first-out (LIFO) stack of items.

    Stores data in last-in, first-out order. When removing an item from the
    stack, the most recently-added item is the one that is removed.
    """
    def __init__(self) -> None:
        """Initialize a new empty stack."""

    def is_empty(self) -> bool:
        """Return whether this stack contains no items.

        >>> s = Stack()
        >>> s.is_empty()
        True
        >>> s.push('hello')
        >>> s.is_empty()
        False
        """

    def push(self, item: Any) -> None:
        """Add a new element to the top of this stack.
        """

    def pop(self) -> Any:
        """Remove and return the element at the top of this stack.

        >>> s = Stack()
        >>> s.push('hello')
        >>> s.push('goodbye')
        >>> s.pop()
        'goodbye'
        """
```

At this point in CSC148, you may immediately picture implementing this with a Python list.
You may be wondering "which end of the list is the top of the stack?"
But this is irrelevant when you are using the ADT.
You are much better off thinking of a pile of objects stacked up.
When you are a client of a stack, you don't need to know the implementation.
The reduction in your cognitive load that the abstraction brings is very important.
Without it, complex, modern software would not be possible.


## The Queue ADT

Another important ADT is a **Queue**.
Like a stack, a queue contains zero or more items, but items come out of a queue
in the order in which they entered.
In other words, a queue exhibits First-in-First-Out (FIFO) behaviour.
The lineup at the corner store is---one hopes---a queue.
We call adding an item to a queue an **enqueue** operation, and the removal of an item a **dequeue** operation.

-   **Queue**

    -    Data: a collection of items
    -    Operations: determine whether the queue is empty, add an item (*enqueue*), remove the least recently-added item (*dequeue*)


## List-based implementation of the Stack ADT

In this section, we'll now implement the Stack ADT using a built-in Python data structure: the `list`.
Note that here, we've chosen to use the *end* of the list to represent the top of the stack.
This wasn't the only viable option!


```python
class Stack:
    """A last-in-first-out (LIFO) stack of items.

    Stores data in first-in, last-out order. When removing an item from the
    stack, the most recently-added item is the one that is removed.

    Private Instance Attributes:
    - _items:
        The items stored in this stack. The end of the list represents
        the top of the stack.
    """
    _items: list

    def __init__(self) -> None:
        """Initialize a new empty stack.
        """
        self._items = []

    def is_empty(self) -> bool:
        """Return whether this stack contains no items.

        >>> s = Stack()
        >>> s.is_empty()
        True
        >>> s.push('hello')
        >>> s.is_empty()
        False
        """
        return self._items == []

    def push(self, item: Any) -> None:
        """Add a new element to the top of this stack.
        """
        self._items.append(item)

    def pop(self) -> Any:
        """Remove and return the element at the top of this stack.

        >>> s = Stack()
        >>> s.push('hello')
        >>> s.push('goodbye')
        >>> s.pop()
        'goodbye'
        """
        return self._items.pop()
```

We'll leave a list-based Queue implementation as an exercise for this week's lab.


## Abstraction is critical

Abstraction is one of the most powerful concepts in computer science.
An ADT is an abstraction so general it transcends any specific programming language.
This kind of abstraction has profound implications.

Looking at the class from the outside, a programmer writing client code needs to understand only its public interface.
This frees them to focus on what they want to do with the class and ignore everything about how it is implemented.[^2]
If a client creates a `Stack` object in their code, they know
there are exactly three operations that can be performed on it:
checking whether it's empty, pushing an item onto it, and popping an item from it.
This reduces cognitive load for the programmer dramatically.
Modern, complex software would be impossible otherwise.

Looking at the class from the inside, the implementer has complete freedom to change implementation details with no effect on client code.
For example, the software can be redesigned to be more efficient, or more elegant (and maintainable).
The entire implementation can even change, and every program that uses the class will still work exactly the same as before.
We call this "plug-out, plug-in compatibility."



<!-- ### Uses for stacks

Because they have so few methods,
it may seem like stacks are not that powerful.
But in fact, stacks are useful for many things.
For instance, they can be used to check for balanced parentheses
in a mathematical expression.  And consider the execution of a Python program.
We have talked about frames that store the names available at a given moment in its execution.
What happens when `f` calls `g`, which calls `h`?
When `h` is over, we go back to `g` and when `g` is over we go back to `f`.
To make this happen, our frames go on a stack!
Typically,
we refer to this as the "call stack", and the frames as "stack frames"


<!-- ## More ADTs

A **Priority Queue** is another ADT and is similar to a Queue,
except that every item has some measure of its "priority".
Items are removed from a Priority Queue according to their priority.
Highest priority items come out first, but if there are ties,
they come out in FIFO order.

Notice that Stack, Queue, and PriorityQueue all share the same operations:
add an item, remove an item, and check if empty.
We can define an even more general ADT called **Container**
that has these operations
and treat Stack, Queue, and PriorityQueue
as children of Container. -->


[^1]: The name "stack" is a deliberate metaphor for a stack of cafeteria trays or books on a table.
[^2]: Imagine if every time you wanted to do `s.split()`
    you had to think through how your string `s` was represented
    and how the `split` method worked.
    It would be a huge distraction from your real task.

    # 4.3 Exceptions

Right now, our stack implementation raises an unfortunate error when client code calls `pop` on an empty `Stack`:[^1]

```python
>>> s = Stack()
>>> s.pop()
Traceback (most recent call last):
  File "<input>", line 1, in <module>
  File "...", line 58, in pop
    return self._items.pop()
IndexError: pop from empty list
```

Let's look at some alternatives for how `pop` could deal with an
inappropriate call.

## Alternative: fail silently

One simple improvement is for the method to "fail silently", making sure to document this behaviour in the method docstring:

```python
    def pop(self) -> Any:
        """Remove and return the element at the top of this stack.

        Do nothing if this stack is empty.

        >>> s = Stack()
        >>> s.push('hello')
        >>> s.push('goodbye')
        >>> s.pop()
        'goodbye'
        """
        if not self.is_empty():
            return self._items.pop()
```

Because the client code in this case expects a value to be returned,
it could use the "no return value" as a sign that something bad happened.
However, this approach doesn't work for all methods;
for example, `push` never returns a value, not even when all goes well,
so failing silently would not alert the client code to a problem until potentially hundreds of lines of code later.
And in `pop`, which *does* return a value,
if we treat `None` as an indication of an error we can never allow client code to push the value `None`,
because if it were later popped,
it would look lik it was indicating that a problem occurred
rather than that the value `None` was just popped off the stack.
There may be clients who want to be able to push `None` onto a stack and to recognize it as a legitimate value when it is popped off again.


## Alternative: Raise a user-defined exception

A better solution is to raise an error when something has gone wrong,
so that the client code has a clear signal.
We want the errors to be descriptive, yet not to reveal any implementation details.
We can achieve this very easily in Python:
we define our own type of error by making a subclass of a
built-in class called `Exception`.
For example,
here's how to define our own kind of `Exception` called `EmptyStackError`:

```python
class EmptyStackError(Exception):
    """Exception raised when calling pop on an empty stack."""
    pass
```

We call this a user-defined exception.[^2]

Here's how we'll use `EmptyStackError` in our `pop` method:

```python
    def pop(self) -> Any:
        """Remove and return the element at the top of this stack.

        Raise an EmptyStackError if this stack is empty.

        >>> s = Stack()
        >>> s.push('hello')
        >>> s.push('goodbye')
        >>> s.pop()
        'goodbye'
        """
        if self.is_empty():
            raise EmptyStackError
        else:
            return self._items.pop()

>>> s = Stack()
>>> s.pop()
Traceback (most recent call last):
  File "<input>", line 1, in <module>
  File "...", line 60, in pop
    raise EmptyStackError
EmptyStackError
```

When we want an `EmptyStackError` to happen, we construct an instance of that new class
and `raise` it.
We have already seen the `raise` keyword in the context of unimplemented methods in
abstract superclasses.
It turns out that this mechanism is very flexible, and can be used anywhere in our code to raise exceptions, even ones that we've defined ourselves.

Notice that the line which is shown to the client is just this simple `raise` statement;
it doesn't mention any implementation details of the `Stack` class.
And it specifies that an `EmptyStackError` was the problem.
Defining and raising our own errors enables us to give descriptive messages to the user
when they have used our class incorrectly.


## Customizing the error message

One current limitation of the above approach is that simply the name of the error class is not necessarily enough to convey a user-friendly error message.
We can change this by overriding the inherited `__str__` method in our class:

```python
class EmptyStackError(Exception):
    """Exception raised when calling pop on an empty stack."""

    def __str__(self) -> str:
        """Return a string representation of this error."""
        return 'You called pop on an empty stack. :('


>>> s = Stack()
>>> s.pop()
Traceback (most recent call last):
  File "<input>", line 1, in <module>
  File "...", line 60, in pop
    raise EmptyStackError
EmptyStackError: You called pop on an empty stack. :(
```


## Exceptions interrupt the normal flow of control

The normal flow of control in a program involves
pushing a stack frame whenever a function is called,
and popping the current (top) stack frame when we reach a `return` or reach the end of the function/method.
When an exception is raised, something very different happens:
**immediately**, the function ends and its stack frame is popped,
sending the exception back to the caller,
which in turn ends immediately, sending the exception back to *its* caller,
and so on until the stack is empty.
At that point, an error message specifying the exception is printed, and the program stops.

In fact, when this happens, much more information is printed.
For every stack frame that is popped,
there was a function/method that had been running and was at a particular line.
The output shows both the line number and line of code.
For example, here is a module that defines two useful methods
and then a very silly one, `mess_about`, whose sole purpose is to demonstrate
how exceptions work:

<img src="images/Exception-code.jpg" alt="Code with line numbers." width="550"/>

Because `mess_about` clears the stack, the call to `second_from_top` is guaranteed to fail
when it tries to pop even one thing from the stack.
At the moment of failure, we are executing `pop`,
and beneath it on the call stack are `second_from_top`, `mess_about`,
and the main block of the module, all on pause and waiting to finish their work.
When pop raises an `EmptyStackError`, we see a full report:

<img src="images/Exception.jpg" alt="Code with line numbers." width="1050"/>

You have undoubtedly seen this kind of error report many times.
Now you should be able to use it as a treasure trove of information about what went wrong.


## Handling exceptions more elegantly

Your code can be written in a way that takes responsibility for "catching" and handling exceptions.
Catching an exception and taking an appropriate action instead of allowing your code to crash
is a much more elegant way of dealing with errors
because it shields the user from seeing errors that they should never see,
and allows the program to continue.

Consider a simple example of asking for input from the user in the form of an integer number,
and testing if the number is a divisor of 42. We need to make sure that the input is well-formed.
That means that we should make sure that it is indeed an integer, as well as check that the number
is not going to result in a division by zero.
Here is an example of how to catch and handle exceptions in a graceful way in this context:

```python
if __name__ == '__main__':
    option = 'y'
    while option == 'y':
        value = input('Give me an integer to check if it is a divisor of 42: ')
        try:
            is_divisor = (42 % int(value) == 0)
            print(is_divisor)
        except ZeroDivisionError:
            print("Uh-oh, invalid input: 0 cannot be a divisor of any number!")
        except ValueError:
            print("Type mismatch, expecting an integer!")
        finally:
            print("Now let's try another number...")
        option = input('Would you like to continue (y/n): ')
```

In the context of our stack, we can similarly handle an `EmptyStackError` in a graceful
manner. We do not necessarily have to print a message to the user (although we do in the code below),
but we must document this exceptional circumstance in the docstring and we must change the
return type from a `str` to `str | None`.

```python
def second_from_top(s: Stack) -> str | None:
    """Return a reference to the item that is second from the top of s.
    Do not change s.

    If there is no such item in the Stack, returns None.
    """

    try:
        # Pop and remember the top 2 items in s.
        hold1 = s.pop()
    except EmptyStackError:
        print("Cannot return second from top, stack empty")
        return None

    try:
        hold2 = s.pop()
    except EmptyStackError:
        print("Cannot return second from top, stack only has one element")
        s.push(hold1)
        return None

    # If we've reached this poing, both hold1 and hold2 refer to items
    # from the stack.
    # Push them back so that s is exactly as it was.
    s.push(hold2)
    s.push(hold1)

    # Return the item that was second from the top.
    return hold2
```

[^1]: Why is this bad from the client code's perspective?
[^2]: Here "user" refers to the programmer, not the person using the program; we call thee latter the "end user" to be more clear.

# 4.4 Analysing Program Running Time

Here is an alternate way of implementing the Stack ADT based on lists,
using the *front* of the list to represent the top of the stack.

```python
class Stack2:
    """Alternate stack implementation.

    This implementation uses the *front* of the Python list to represent
    the top of the stack.
    """
    # Private Attributes:
    # _items:
    #     The items stored in the stack. The front of the list represents
    #     the top of the stack.
    _items: list

    def __init__(self) -> None:
        """Initialize a new empty stack."""
        self._items = []

    def is_empty(self) -> bool:
        """Return whether this stack contains no items.

        >>> s = Stack()
        >>> s.is_empty()
        True
        >>> s.push('hello')
        >>> s.is_empty()
        False
        """
        return self._items == []

    def push(self, item: Any) -> None:
        """Add a new element to the top of this stack."""
        self._items.insert(0, item)

    def pop(self) -> Any:
        """Remove and return the element at the top of this stack.

        Raise an EmptyStackError if this stack is empty.

        >>> s = Stack()
        >>> s.push('hello')
        >>> s.push('goodbye')
        >>> s.pop()
        'goodbye'
        """
        if self.is_empty():
            raise EmptyStackError
        else:
            return self._items.pop(0)
```

Even though this implementation seems to be conceptually the same as the first (one uses the back of the list, the other uses the front), it turns out their runtime performance is quite different!

## A simple time profiler

By making use of a built-in Python library called `timeit`, we can easily get rough estimates of how long our code takes to run.
The key function we import is called `timeit`,[^1]
which takes in a piece of Python code to execute, and returns a float representing the amount of time it took to execute it.
We illustrate the use of the `timeit` function in the following example:

```python
def push_and_pop(s: Stack) -> None:
    """Push and pop a single item onto <stack>.

    This is simply a helper for the main timing experiment.
    """
    s.push(1)
    s.pop()


if __name__ == '__main__':
    # Import the main timing function.
    from timeit import timeit

    # The stack sizes we want to try.
    STACK_SIZES = [1000, 10000, 100000, 1000000, 10000000]
    for stack_size in STACK_SIZES:
        # Uncomment the stack implementation that we want to time.
        stack = Stack()
        # stack = Stack2()

        # Bypass the Stack interface to create a stack of size <stack_size>.
        # This speeds up the experiment, but we know this violates encapsulation!
        stack._items = list(range(stack_size))

        # Call push_and_pop(stack) 1000 times, and store the time taken in <time>.
        # The globals=globals() is used for a technical reason that you can ignore.
        time = timeit('push_and_pop(stack)', number=1000, globals=globals())

        # Finally, report the result. The :>8 is used to right-align the stack size
        # when it's printed, leading to a more visually-pleasing report.
        print(f'Stack size {stack_size:>8}, time {time}')
```

Running this code on a `Stack` and a `Stack2` instance
illustrates a stark difference between these two classes. While the
`Stack` instance seems to take the **same** amount of time per operation regardless of how
many items are on the stack, the `Stack2` class seems to have the amount of time grow with
the number of items on the stack. In fact, the amount of time required in a `Stack2` operation is
roughly proportional to the size of the stack, while the amount of time required in `Stack`
is *independent* of the size of the stack!


## Memory allocation for lists in Python

To understand why there's such a dramatic difference, we really need to understand how
Python lists are stored in memory.

Recall that a variable in Python stores a *reference* to an object.
A Python list is a special type of object that contains an ordered sequence of references to other objects,
which we call the elements of the list.
Importantly, these references are stored in consecutive blocks of memory---just as we've been drawing them in our memory model diagrams so far.
This is what makes accessing list elements so fast: getting the *i*-th list item can be
done just by calculating its address (i.e., location in the computer's memory),
based on the address where the list starts, and offset by *i* addresses.[^2]


To preserve this characteristic, lists must always be contiguous; there can't be any "gaps", or else Python couldn't calculate the memory address of the *i*-th list item.
But this makes insertion and deletion less efficient:
for an item to be deleted, all items after it have to be moved down one block in memory,
and similarly, for insertion all items are moved up one block.
We have a trade-off:
we give up fast insertion and deletion in order to gain fast lookup by index.

There is one more important feature of Python lists
that you should know,
and it makes adding elements at the end of the list very fast:
when you create a new list in Python, it actually allocates (assigns) more memory to the list than
the list
actually requires. If you create a list of 4 elements, you might get enough space to hold 8
elements. The exact numbers are implementation-specific and not important here; the general
idea is that there is usually free space at the end of the list that the list can "expand"
into. In particular, if you want to add an object to the end of the list, you can simply
add a reference to it into that spot.
On the other hand, if you want to add a new item to the
list and there is no more free space, a new and larger chunk of memory is allocated
for the list and every item is copied into it.[^3]

<!-- <img src="images/list_memory.png" alt="List diagram." width="80%"></img> -->

The net effect of these implementation details is that it's much faster
to add and remove at the end of the list than at its front!
Adding at the end usually requires only expanding into the extra space; occasionally
there won't be any extra space left, and some time-consuming work has to be done.
But on balance, adding at the end is much less time-consuming than adding at the beginning,
which *always* requires shifting every element down a spot.
(Removing items is analogous.)
Now the reason for the speed difference in our stack example is clear!


## Analysing algorithm running time

In evaluating the quality of our programs, we have talked about two metrics so far.
The first is correctness: does our code actually work, even in special corner cases, and handle errors appropriately?
The second is design: is the code carefully designed, and well-documented so that it is easy to understand and work with by both clients and implementers of the code?

From what we've seen about the two different stack implementations, there is certainly
another way in which we can determine the quality of our code: how quickly the code runs.
We will now study how to assess the **running time efficiency** of our
programs rigorously, and communicate these ideas with other computer scientists.


## Observations about runtime

First, recall that for most algorithms, their running time depends on the size of the input---as the input numbers or lists get larger, for example, we expect algorithms operating on
them to increase as well. So when we measure efficiency, we really care about a *function*
of the amount of time an algorithm takes to run in terms of the size of the input. We can
write something like $T(n)$ to denote the runtime of a function of size $n$ (but note that
this isn't always necessarily $n$).

How best to measure runtime? We might try to use tools like the `timeit` function, but
there are many factors that influence the time it takes for code to run: how powerful your
machine is, how many other programs are running at the same time. As with Schr枚dinger's cat,
even the act of observing the runtime can affect performance!

What about the number of basic steps an algorithm takes? This is a bit better, but still
subtly misleading: do all "basic" operations take the same amount of time? What counts as a
basic operation? Etc. etc.

This is where Big-Oh comes in: it allows an elegant way of roughly characterizing the *type* of
growth of the runtime of an algorithm, without actually worrying about things like how different
CPUs implement different operations, whether a for loop is faster than a while loop, etc. Not
that these things aren't important---they are simply at another level of detail. There is no
point fussing about this level of detail until we know the vastly larger kind of differences
in growth rate that Big-Oh is designed to describe.

When we characterise the Big-Oh property of a function, we really are thinking about
general terms like *linear*, *quadratic*, or *logarithmic* growth.
For example, when we see a loop through a list like this:

```python
for item in lst:
    # do something with item
```

we know that the runtime is proportional to the length of the list.
If the list gets twice as long, we'd expect this algorithm to take twice as long.
The runtime grows linearly with the size of the list, and we write that the runtime is $O(n)$, where *n* is the length of the list.

## Ignoring constants, focusing on behaviour as problem size grows

In CSC165/CSC240, you learn about the formal mathematical definition of Big-Oh notation, but this
is not covered in this course. Intuitively, Big-Oh notation allows us to analyse the
running time of algorithms while ignoring two details:

1.  The constants and lower-order terms involved in the step counting:
    $5n$, $n + 10$, $19n - 10$, $0.05n$ are all $O(n)$---they all have *linear* growth.
2.  The algorithm's running time on small inputs.
    The key idea here is that an algorithm's behaviour as the input size gets very large is much more important than how quickly it runs on small inputs.

Instead, Big-Oh notation allows us to capture how running time grows as the problem size grows.
We say that Big-Oh deals with *asymptotic* runtime.

Note that these points mean that Big-Oh notation is not necessarily suitable for all
purposes. For example, even though the sorting algorithm mergesort runs in time $O(n \log
n)$ and the algorithm insertion sort runs in time $O(n^2)$, for small inputs (e.g., lists
of size <= 10), insertion sort runs significantly faster than mergesort in practice! And
sometimes the constants are important too---even though yet another algorithm called
quicksort is (on average) an $O(n \log n)$ algorithm, it has smaller constants than
mergesort and so typically runs faster in practice. Neither of these practical observations
are captured by the sorting algorithms' respective Big-Oh classes!

## Terminology and mathematical intuition

Here is a table that summarizes some of the more common Big-Oh classes, and the English
terminology that we use to describe their growth:

| Big-Oh   | Growth term               |
|----------|---------------------------|
| $O(\log n)$ | logarithmic               |
| $O(n)$    | linear                    |
| $O(n^2)$   | quadratic                 |
| $O(2^n)$  | exponential (with base 2) |

Notice that we say growth is "exponential" when the variable is in the exponent, as in
$2^n$ (but not $n^2$).

There is a very nice mathematical intuition that describes these classes too. Suppose we
have an algorithm which has running time $N_0$ when given an input of size $n$, and a
running time of $N_1$ on an input of size $2n$. We can characterize the rates of growth in
terms of the relationship between $N_0$ and $N_1$:

| Big-Oh   | Relationship          |
|----------|-----------------------|
| $O(\log n)$ | $N_1 \approx N_0 + c$ |
| $O(n)$     | $N_1 \approx 2N_0$    |
| $O(n^2)$   | $N_1 \approx 4N_0$    |
| $O(2^n)$   | $N_1 \approx (N_0)^2$ |

## Constant time

There is one more use of Big-Oh notation that we require,
which is to capture the case of a function whose asymptotic growth does *not* depend on its input!
For example, consider the constant function $f(n) = 10$.
This function doesn't depend on its input, and so we say that it has
*constant asymptotic behaviour*, writing $O(1)$ to represent this.

In the context of running time, we would say that a particular function or method "runs in constant time" to say that its runtime doesn't depend on the size of its input.

For example, our above discussion about index lookup in array-based Python lists can be summarized by saying that it is a *constant time operation*: looking up `lst[i]` takes time that does *not* depend on either `len(lst)` or `i` itself!

[^1]: Yes, this function has the same name as the library itself. This is actually fairly common.
[^2]: Think about it like this: suppose you're walking down a hallway with numbered rooms on just one side and room numbers going up by one.
    If you see that the first room number is 11, and you're looking for room 15, you can be confident that it is the fifth room down the hall.
[^3]: You'll learn more about the details of such an implementation in our data structures course, CSC263/265.