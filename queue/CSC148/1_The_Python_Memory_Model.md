# 1.1 The Python Memory Model: Introduction

Before we dive into the CSC148 material proper,
we'll review a few fundamental concepts from CSC108.
We start with one of the most important ones: how the Python programming language represents data.

## Data

All data in a Python program is stored in objects that have three components:
id, type, and value.
We normally think about the value when we talk about data,
but the data's type and id are also important.

The **id** of an object is a unique identifier,
meaning that no other object has the same identifier.
Often Python uses the memory address of the object as its id,
but it doesn't have to;
it just has to guarantee uniqueness.
We can see the id of any object by calling the `id` function:

```python
>>> id(3)
1635361280
>>> id('words')
4297547872
```

We can see the **type** of any object by calling the `type` function:

```python
>>> type(3)
<class 'int'>
>>> type('words')
<class 'str'>
```

An object's type determines what functions can operate on it.
For example, we can call the function `round` on numeric types
(such as `int` and `float`), but not on strings:

```python
>>> round(2)
2
>>> round(3.1419)
3
>>> round('hello!')
Traceback (most recent call last):
  File "<input>", line 1, in <module>
TypeError: type str doesn't define __round__ method
```

Types also determine the objects on which we can use built-in Python operators.[^1]
For example, the `+` operator works on two integers,
and even on two strings,
but is not defined for adding an integer and a string together:

```python
>>> 3 + 4
7
>>> 'hey' + 'hello'
'heyhello'
>>> 3 + 'hello'
Traceback (most recent call last):
  File "<input>", line 1, in <module>
TypeError: unsupported operand type(s) for +: 'int' and 'str'
>>> 'hello' + 'goodbye'
'hellogoodbye'
```

Finally, you are already familiar with accessing the *value* of an object, which we call *evaluating* the object.
For example, this is what happens when we type an object into the Python terminal:
<!-- Diane: We are not being clear here about the distinction between the expression
and the object / "piece of data".  Also, should we discuss how evaluating an expression
causes an object containing its value to be created?
Dan: I'd vote for keeping it as-is and moving quickly past this point. We can be more precise but it might be unnecessarily detailed.
-->

```python
>>> 3
3
>>> 'hello'
'hello'
```


## Variables

All programming languages have the concept of variables.
In Python, a variable is not an object, and so does not actually store data;
it stores an id that *refers* to an object that stores data.
This is the case whether the data is something very simple like an `int`
or more complex like a `str`.

Consider this code:

```python
>>> x = 3
>>> x
3
>>> type(x)
<class 'int'>
>>> id(x)
1635361280
>>> word = 'bonjour'
>>> type(word)
<class 'str'>
>>> id(word)
4385008808
```

The state of memory after the above piece of code executes is this:

```{image} images/Variables-crop.jpg
:alt: 'There are two variables, x and word. Each is a container holding just one thing: the id of an object. x contains the id of an int object, and that int object is a container holding the value 3. word contains the id of a str object, and that str object is a container holding the value `bonjour`.'
:width: 250px
:align: center
```

We write the id and type of each object in its upper-left corner
and upper-right corner, respectively.
The actual object id reported by the `id` function
has many digits, and its true value isn't important;
we just need to know that each object has a unique identifier.
So for our drawings we make up short identifiers such as `id92`.

Notice that there is no `3` inside the box for variable `x`.
Instead, there is the *id* of an object whose value is 3.
We say that `x` **refers to** this object,
or that `x` **references** this object.
The same holds for variable `word`;
it references an object whose value is `'bonjour'`.

Here are a couple of other things to notice:

- Since we did not write the code for the class that defines
  the `str` type, we know nothing about
  what data members it uses to store its contents.
  So we just write the value `'bonjour'` inside the box.
  This is a perfectly fine abstraction.
- We didn't draw any arrows.
  Programmers often draw an arrow when they want to show that one thing references another.
  This is great once you are very confident with a language and how references work.
  But in the early stages, you are much more likely to make correct predictions if you write down references
  (you can just make up id values) rather than arrows.

We can reassign a variable so that it refers to a new value.
For instance:

```python
>>> cat = 'Gilbert'
>>> id(cat)
4348845448
>>> cat = 'Chairman Meow'
>>> id(cat)
4355636784
```

In this example, there is only one variable named `cat`.
At first it contains the id of a `str` object containing the string `Gilbert`,
and then the id in it changes to be that of a `str` object containing the string `Chairman Meow`.

These examples are extremely simple, but
having an accurate image will be necessary in order to avoid bugs
in the much more complex code that we will write this term.

### Objects have a type, but variables don't

We saw above that Python will report to us what `type(word)` is.
But it is really reporting the type of the object that `word` refers to.
The variable `word` itself has no type.[^2]
In fact, Python doesn't mind if we make `word` refer now to a different type of
object, although this is almost surely a bad idea.

```python
>>> word = 'adieu'
>>> type(word)
<class 'str'>
>>> word = 42
>>> type(word)
<class 'int'>
```

## Assignment statements and evaluating expressions

You've written code much more complex than what's above,
but may not have had to think in detail about all the small
steps that Python has to undertake to execute even
a simple assignment statement.
These details are foundational for writing and debugging
the more complex code you will work on in csc148.
So let's pause for a moment
and be explicit about two things.

### Executing an assignment statement

This is what Python does when an assignment statement is executed:

1. Evaluate the expression on the right-hand side, yielding the id of an object.
2. If the variable on the left-hand-side doesn't already exist, create it.
3. Store the id from the expression on the right-hand-side in the variable on the left-hand side.


### Evaluating an expression

An assignment statement always has an expression on the
right-hand side.
Expressions can occur in other places also,
for instance as arguments to a function call.
When an expression is encountered, it must be evaluated.
This always yields a value, which is the id of an object.

This is what Python does when an expression is evaluated:

- If the expression is a variable, find the variable.
If it doesn't exist, this is an error.
If it does exist, the value of the expression is the
id stored in that variable.
- If the expression is a "literal value", such as `176.4` or `'hello'`,
create an object of the appropriate type to hold it.
The value of the expression is the id of that object.
- If the expression is an operator, such as `+` or `%`,
evaluate its two operands, apply the operator to them,
and create a new object of the appropriate type to hold the result.
The value of the expression is the id of that object.

There are additional rules for other types of expression,
but these will do for now.


## Mutability

### Immutable data types

Some data types in Python (e.g., integers, strings, and booleans) are **immutable**,
meaning that the value stored in an object of that type cannot change.

For example, suppose we have the following code:

```python
>>> prof = 'Diane'
>>> id(prof)
4405312456
>>> prof = prof + ' Horton'
>>> prof
'Diane Horton'
>>> # The old str object couldn't change, so Python made a new
>>> # str object for the variable prof to refer to.  Since it's
>>> # a new object, it has a different id.
>>> id(prof)
4405308016
```

We did not change the value stored in the object---we couldn't, since strings are immutable---but rather changed *what `prof` refers to*,
as shown here:

```{image} images/Immutable-type-crop.jpg
:alt: Immutable types
:width: 250px
:align: center
```

From now on, we will use the convention of drawing a double box around objects that are immutable.
Think of it as signifying that you can't get in there and change anything.

Notice that in the example above
we reassigned the variable `prof`---that is, we made it refer to a new `str` object---
and we could do this even though strings are immutable.
Regardless of the mutability of any objects,
we can always reassign a variable.


### Mutable data types

More complex data structures in Python are mutable,
including lists, dictionaries, and user-defined classes.
Let's see what this means with a list:

```python
>>> x = [1, 2, 3]
>>> x
[1, 2, 3]
>>> type(x)
<class 'list'>
>>> id(x)
50706312
```

Below, we perform two mutating operations on `x`, and check that its id hasn't changed.
Note that even changing the list's size doesn't change its id!

```python
>>> x[0] = 1000000
>>> x
[1000000, 2, 3]
>>> id(x)
50706312
>>> x.extend([10, 20, 30])
>>> x
[1000000, 2, 3, 10, 20, 30]
>>> id(x)
50706312
```

Here's what's going on in memory:

```{image} images/Mutable-type-crop.jpg
:alt: mutable types
:width: 600px
:align: center
```

The lines `x[0] = 1000000` and `x.extend([10, 20, 30])`
changed the value of the list object that `x` refers to.
We say that these lines **mutate** the object that `x` refers to.
(They also cause the creation of four new objects of type `int`.)

## Aliasing

When two variables refer to the same object,
we say that the variables are **aliases** of each other.[^3]

Consider the following Python code:

```python
>>> x = [1, 2, 3]
>>> y = [1, 2, 3]
>>> z = x
```

`x` and `z` are aliases, as they both reference the same object.
As a result, they have the same id.
You should think of the assignment statement `z = x` as saying
"make `z` refer to the object that `x` refers to."
After doing so, they have the same id.

```python
>>> id(x)
4401298824
>>> id(z)
4401298824
```

In contrast, `x` and `y` are not aliases.
They each refer to a list object with `[1, 2, 3]` as its value,
but they are two different list objects, stored separately in your computer's memory.
This is again reflected in their different ids.

```python
>>> id(x)
4401298824
>>> id(y)
4404546056
```

Here is the state of memory after the code executes:

```{image} images/Aliasing-crop.jpg
:alt: Aliasing example. There are two different list objects. They have identical contents, but are distinct objects, each with their own id. There are three variables, x, y, and z. x and z both contain the same id, the id of one of the list objects. y contains the id of the other list object.
:width: 400px
:align: center
```


### Aliasing and mutation

Aliasing is often a source of confusion for beginners,
because it allows "action at a distance":
the modification of a variable's value
without explicitly mentioning that variable.
Here's an example:

```python
>>> x = [1, 2, 3]
>>> z = x
>>> z[0] = -999
>>> x   # What is the value?
```

The third line mutates the value of `z`.
But without ever mentioning `x`, it also mutates the value of `x`!
We call this a **side effect**.

Imprecise language can lead us into misunderstanding the code.
We said above that
"the third line mutates the value of `z`".
To be more precise,
the third line mutates the object that `z` refers to.
Of course we can also say that it mutates the object that `x` refers to---they are
the same object!
A clear diagram like this can really help:

```{image} images/Alias-mutate-crop.jpg
:alt: aliasing and mutation
:width: 350px
:align: center
```

The key thing to notice about this example is that
just by looking at the third line of code, `z[0] = -999`,
you can't tell that `x` has changed;
you need to know that on a previous line, `z` was made an alias of `x`.
This is why you have to be careful when aliasing occurs.

Contrast the previous code with this:

```python
>>> x = [1, 2, 3]
>>> y = [1, 2, 3]
>>> y[0] = -999
>>> x   # What is the value?
```

Can you predict the value of `x` on the last line?
Here, the third line mutates the object that `y` refers to,
but because it is not the same object that `x` refers to,
we still see `[1, 2, 3]` if we evaluate `x`.
Here's the state of memory after these lines execute:

```{image} images/Copy-mutate-crop.jpg
:alt: Aliasing and mutation
:width: 350px
:align: center
```


Aliasing also exists for immutable data types, but in this case there is never any "action at a distance", precisely because immutable values can never change.
For example, a tuple is an ordered sequence like a list, but it is immutable.
In the example below, `x` and `z` are aliases of a tuple object;
but it is impossible to create a side effect on `x` by mutating the object that `z` refers to,
since we can't mutate tuples at all.

```python
>>> x = (1, 2, 3)
>>> z = x
>>> z[0] = -999
Traceback (most recent call last):
  File "<input>", line 1, in <module>
TypeError: 'tuple' object does not support item assignment
```


### Changing a reference is not the same as mutating a value

What if we did this instead?

```python
>>> x = (1, 2, 3)
>>> z = x
>>> z = (1, 2, 3, 40)
>>> x   # What is the value?
```

Again, we have made `x` and `z` refer to the same object.
So when we change `z` on the third line, does `x` also change?
This time, the answer is an emphatic **no**,
and it is because of the kind of change we make on the third line.
Instead of mutating the object that `z` refers to,
we make `z` refer to a new object.
This obviously can have no effect on the object that `x` refers to
(or *any* object).
Even if we switched the example from using immutable tuples
to using mutable lists, `x` would be unchanged.

In general,
a statement of the form `my_var = _____`
**never mutates** the object that `my_var` refers to;
all it can ever do is set `my_var` to refer to a different object.
Keep this rule in mind when you're writing your own code,
as it's often easy to confuse mutating values with changing references.


### Making a copy to avoid side effects

Sometimes it makes sense to make a copy of a data structure
so that changes can be made to it without any side effect on the original.
Keep in mind, though, that this consumes both space and time resources, and is often unnecessary.


## Two types of equality

Let's look one more time at this code:

```python
>>> x = [1, 2, 3]
>>> y = [1, 2, 3]
>>> z = x
>>> id(x)
4401298824
>>> id(y)
4404546056
>>> id(z)
4401298824
```

What if we wanted to see whether `x` and `y`, for instance, were the same?
Well, we'd need to define precisely what we mean by "the same."
We can use the `==` operator
to compare the *values* stored in the objects they reference.
This is called **value equality**.

```python
>>> x == y
True
>>> x == z
True
```

Or, we can use the `is` operator to compare the *ids* of the objects they reference.
With `is`,
we are asking whether two variables reference the exact same object.
This is called **identity equality**.

```python
>>> x is y
False
>>> x is z
True
```

All built-in types have an implementation for `==` so that we can check for value equality;
we'll later see how to define `==` for our own classes.

### A shortcut with immutable objects

Because ints are immutable,
there isn't much point in Python creating a separate int object every time your variable needs to refer to, say, 0.
They can all refer to the very same object and no harm can be done since the object can never change.
This explains the following code:

```python
>>> x = 43
>>> y = 43
>>> z = x
>>> # Of course we see that all three variables have value
>>> # equality. They all reference an int object containing
>>> # 43.  Whether or not they are the same int object is
>>> # irrelevant to "==".
>>> x == y
True
>>> x == z
True
>>> # But "is" checks identity equality.  We wouldn't have
>>> # expected x and y to reference the same int object.
>>> # But now we know that Python feels free to take a
>>> # short-cut and not create a second int object holding
>>> # the value 43, and in this case it did:
>>> x is y
True
>>> x is z
True
>>> # We can confirm that x and y have the same id:
>>> id(x)
4331557184
>>> id(y)
4331557184
```

Python can take this short-cut with any value of any immutable type.
For example, here we can observe the short-cut with strings:

```python
>>> x = 'foo'
>>> y = 'foo'
>>> x is y
True
```

But in this example, Python *doesn't* take the short-cut:

```python
>>> x = "ice cream"
>>> y = "ice cream"
>>> x is y
False
```

It turns out that when Python does and doesn't take the short-cut is quite complex,
and it could even change from one version of Python to the next.
But it makes no difference to our code's behaviour;
the only reason we need to be aware of it is so that we are not surprised
when we see that two variables unexpectedly have identity equality.

## Some Python basics that interact with the memory model

### Lists

#### Mutating and non-mutating list methods

Lots of list methods, such as `count` and `index` return a value and do not mutate the list they are called on.

```python
>>> lst = [9, 0, 5, 8, 9, 1]
>>> id(lst)
140623854885120
>>> lst.count(9)
2
>>> lst.index(8)
3
>>> id(lst)  # lst is still referencing the same list object.
140623854885120
>>> lst
[9, 0, 5, 8, 9, 1]  # And the contents of that object are unchanged.
```

Calls to these methods are easy to trace in the memory model, since nothing is mutated.
Other list methods, such as `insert` do mutate the list they are called on.

```python
>>> lst.insert(3, 999)
>>> id(lst)
140623854885120  # lst still references that same list object.
>>> lst
[9, 0, 5, 999, 8, 9, 1]  # But the contents of it have been changed.

```

To trace calls to mutating methods using the memory model, we simply have to change what's inside the list object.

#### Append vs extend

By now you know list methods `append` and `extend`.
They are similar in that they mutate a list by putting another list into it;
but they create two different structures.
With `extend`, the individual elements of the new list are added, one by one, to the original list.


```python
>>> new_list = [4, 1, 6]
>>> id(new_list)
140623854891392
>>> lst.extend(new_list)
>>> id(lst)
140623854885120  # lst still references the same list object.
>>> lst
[9, 0, 5, 999, 8, 9, 1, 4, 1, 6]  # But we have mutated it.
>>> id(new_list) # new_list, of course, references the same object as before.
140623854891392
>>> new_list # And it is unchanged.
[4, 1, 6]

```

We extended `lst` with another list of length 3, so the length of `lst` went up by 3.
`append` is different: it adds the new list to the original list as a single new item.

```python
>>> another_list = [5, 10]
>>> id(another_list)
140623854919040
>>> lst.append(another_list)
>>> id(lst)
140623854885120
>>> lst
[9, 0, 5, 999, 8, 9, 1, 4, 1, 6, [5, 10]]
```

Even though we appended a list of length 2, the length of `lst` only went up by 1
because we put that entire new list inside `lst.`

This may feel quite basic.
Can you use your understanding of these methods to fill in the missing output here?

```python
>>> lst1 = [1, [2, 3], 4]
>>> lst2 = [5, [6, 7, 7]]
>>> lst1.extend(lst2)
>>> lst1
[1, [2, 3], 4, 5, [6, 7, 7]]
>>> lst2.append(10)
>>> lst2
[5, [6, 7, 7], 10]
>>> lst1


>>> lst2[0] = 15
>>> lst2
[15, [6, 7, 7], 10]
>>> lst1


>>> lst2[1].append(100)
>>> lst2
[15, [6, 7, 7, 100], 10]
>>> lst1


>>> lst1.append(99)
>>> lst1


>>> lst2


>>> lst1[3] = 25
>>> lst1


>>> lst2


>>> lst1[4][1] = 1001
>>> lst1


>>> lst2


```
Run the code in the Python shell to see if your predictions are correct.


<!-- Answers:
```python
>>> lst1 = [1, [2, 3], 4]
>>> lst2 = [5, [6, 7, 7]]
>>> lst1.extend(lst2)
>>> lst1
[1, [2, 3], 4, 5, [6, 7, 7]]
>>> lst2.append(10)
>>> lst2
[5, [6, 7, 7], 10]
>>> lst1
[1, [2, 3], 4, 5, [6, 7, 7]]  # Unchanged
>>> lst2[0] = 15
>>> lst2
[15, [6, 7, 7], 10]
>>> lst1
[1, [2, 3], 4, 5, [6, 7, 7]]  # Unchanged
>>> lst2[1].append(100)
>>> lst2
[15, [6, 7, 7, 100], 10]
>>> lst1
[1, [2, 3], 4, 5, [6, 7, 7, 100]]  # Changed
>>> lst1.append(99)
>>> lst1
[1, [2, 3], 4, 5, [6, 7, 7, 100], 99]
>>> lst2
[15, [6, 7, 7, 100], 10]  # Unchanged
>>> lst1[3] = 25
>>> lst1
[1, [2, 3], 4, 25, [6, 7, 7, 100], 99]
>>> lst2
[15, [6, 7, 7, 100], 10]  # Unchanged
>>> lst1[4][1] = 1001
>>> lst1
[1, [2, 3], 4, 25, [6, 1001, 7, 100], 99]
>>> lst2
[15, [6, 1001, 7, 100], 10]  # Changed
```
-->

#### Under the hood of append and extend

If this exercise raises questions for you, great!
We have glossed over a crucial detail, without which we can't
reliably predict what our code will do as we continue to use these mutated lists:
Does `extend` put
the ids of the elements of `lst2` into `lst1`, or does it make copies of these elements?
The answer is that it does *not* make copies;
instead it puts the ids of the elements of `lst2` into `lst1`, which creates aliasing.
If the aliased objects are mutable, as you know, this allows side effects to happen.

Here's a smaller example of `extend`:

```python
>>> stuff = [10, 20]
>>> new_stuff = [30, [40, 50]]
>>> stuff.extend(new_stuff)
>>> stuff
[10, 20, 30, [40, 50]]
```

This is what's going on in memory when we run this code:

```{image} images/Extend-crop.jpg
:alt: A memory model diagram showing stuff and new_stuff as they are initially, and then in orange showing the effect of extend.
:align: center
```

The ids inside the elements of `new_stuff`, id3 and id102, are added to the end of `stuff`, creating aliasing.
Here is the same example, but using `append` instead:

```python
>>> stuff = [10, 20]
>>> new_stuff = [30, [40, 50]]
>>> stuff.append(new_stuff)
>>> stuff
[10, 20, [30, [40, 50]]]
```

And here is the corresponding memory model diagram:

```{image} images/Append-crop.jpg
:alt: A memory model diagram showing stuff and new_stuff as they are initially, and then in orange showing the effect of append.
:align: center
```

Notice that, this time, the id of the list `new_stuff` itself, id101, is added to the end of `stuff`.
This also creates aliasing.

Now that you have a clear picture of what exactly `append` and `extend` do, go back and predict again the output of the slightly more complex code above with `lst1` and `lst2`.

#### What about list operators?

The operator `+` can be applied to two lists.
It does not mutate either list.
Instead, it creates a new list containing all the elements of each operand.

For example, this code:

```python
>>> stuff = [10, 20]
>>> new_stuff = [30, [40, 50]]
>>> result = stuff + new_stuff
>>> result
[10, 20, 30, [40, 50]]
```

yields this memory model:

```{image} images/Plus-crop.jpg
:alt: A memory model diagram showing what happens when we apply the plus operator to stuff and new_stuff.
:align: center
```

This explains why some of the following mutations to `stuff` and `new_stuff` have no effect on `result`,
but others do.

```python
>>> new_stuff[1].append(99)
>>> new_stuff
[30, [40, 50, 99]]
>>> result
[10, 20, 30, [40, 50, 99]]
>>> stuff[1] = 1111
>>> result
[10, 20, 30, [40, 50, 99]]
>>> stuff.append(2222)
>>> result
[10, 20, 30, [40, 50, 99]]
>>> new_stuff.append(3333)
>>> result
[10, 20, 30, [40, 50, 99]]
>>> new_stuff[1] = 3333
>>> result
[10, 20, 30, [40, 50, 99]]
```

Another list operator we use a lot is `:` for slicing.
Slicing always creates a new list, containing the selected elements of the list it was applied to.

For example, this code:

```python
>>> junk = [[1, 2], 3, [4, 5]]
>>> result = junk[1:]
>>> result
[3, [4, 5]]
```

yields this memory model:

```{image} images/Slice-crop.jpg
:alt: A memory model diagram showing what happens when we slice the list called junk.
:align: center
```

Try writing your own code that mutates `junk` in different ways to see which of them have an effect on `result`.
Can you predict the outcome accurately?


### For loops

You've written many for-loops that iterate over lists.  Here's a simple one:

```python
>>> nums = [5, 9, 2, 1, 4]
>>> sum = 0
>>> for item in nums:
...     sum = sum + item
...
>>> print (sum)
21
```

Something is going on that is not apparent from the code:
a new variable, `item`, is created and, on each iteration,
it is assigned to refer to the next element of the list.
It is as if we'd written:

```python
>>> nums = [5, 9, 2, 1, 4]
>>> sum = 0
>>> item = nums[0]
>>> sum = sum + item
>>> item = nums[1]
>>> sum = sum + item
>>> item = nums[2]
>>> sum = sum + item
>>> item = nums[3]
>>> sum = sum + item
>>> item = nums[4]
>>> sum = sum + item
>>> print(sum)
21
```

This may not seem important, but consider a list of mutable objects (rather than the immutable ints in our list above).
Each time we assign `item` to refer to one of them, we have aliasing.
Understanding this aliasing, and being aware of the mutability or imutability of our list elements,
will allow you to explain why some loops work and some don't -- and, preferably, to always write loops that work!

[^1]: We'll see later in the course that most of Python's operators are actually implemented using functions.
[^2]: This is different from many other languages, such as Java and C, where every variable has a type.
[^3]: My dictionary says that the word "alias" is used when a person is also known under a different name.
    For example, we might say "Eric Blair, alias George Orwell."
    We have two names for the same thing, in this case a person.

    # 1.2 The Python Memory Model: Functions and Parameters

## Terminology

Let's use this simple example to review some terminology that should be familiar to you:

```python
# Example 1.

def mess_about(n: int, s: str) -> None:
    message = s * n
    print(message)

if __name__ == '__main__':
    count = 13
    word = 'nonsense'
    mess_about(count, word)
```

In the function declaration,
each variable in the parentheses
is called a **parameter**.
Here, `n` and `s` are parameters of function `mess_about`.
When we call a function, each expression in the parentheses
is called an **argument**.
The arguments in our one call to `mess_about` are `count` and `word`.


## How function calls are tracked

Python must keep track of the function that is currently running,
and any variables defined inside of it.
It stores this information in something called a **stack frame**, or just "frame" for short.

Every time we call a function, the following happens:

1.  A new frame is created and placed on top of any frames that may already exist.
    We call this pile of frames the **call stack**.
2.  Each parameter is defined inside that frame.
3.  The arguments in the function call are evaluated, in order from left to right.
	Each is an expression, and evaluating it yields the id of an object.
    Each of these ids is assigned to the corresponding parameter.

Then the body of the function is executed.

In the body of the function there may be assignment statements.
We know that if the variable on the left-hand-side of the assignment doesn't
already exist, Python will create it.
But with the awareness that there may be a stack of frames, we need a slightly
more detailed rule:

> If the variable on the left-hand-side of the assignment doesn't already exist
> *in the top stack frame*, Python will create it *in that top stack frame*.

For example, if we stop our above sample code right before printing `message`,
this is the state of memory:

```{image} images/Parameters-crop.jpg
:alt: A memory model diagram showing the state of memory before printing `message`.
:width: 450px
:align: center
```

Notice that the top stack frame, for our call to `mess_about`, includes
the new variable `message`.
We say that any new variables defined inside a function are **local variables**;
they are local to a call to that function.

When a function returns,
either due to executing a `return` statement or
getting to the end of the function,
the frame for that function call is deleted.
All the variables defined in it---both parameters and local variables---disappear.
If we try to refer to them after the function has returned, we get an error.
For example, when we are about to execute the final line in this program,

```python
# Example 2. (Same as Example 1, but with a print statement added.)

def mess_about(n: int, s: str) -> None:
    message = s * n
    print(message)

if __name__ == '__main__':
    count = 13
    word = 'nonsense'
    mess_about(count, word)
    print(n)
```

this is the state of memory,

```{image} images/Parameters-popped-crop.jpg
:alt: variables
:width: 450px
:align: center
```

which explains why the final line produces the error
`NameError: name 'n' is not defined`.


## Passing an argument creates an alias

What we often call "parameter passing"
can be thought of as essentially variable assignment.
In the example above, it is as if we wrote
```python
n = count
s = word
```
before the body of the function.

If an argument to a function is a variable,
what we assign to the function's parameter is
the id of the object that the variable references.
This creates an alias.
As you should expect, what the function can do with these aliases depends on whether or not the object is mutable.


## Passing a reference to an immutable object

If we pass a reference to an immutable object,
we can do whatever we want with the parameter and there will be no effect
outside the function.

Here's an example:

```python
# Example 3.

def emphasize(s: str) -> None:
    s = s + s + '!'

if __name__ == '__main__':
    word = 'moo'
    emphasize(word)
    print(word)
```

This code prints plain old `moo`.
The reason is that, although we set up an alias,
we don't (and can't) change the object that both `word` and `s` reference;
we make a new object.
Here's the state of memory right before the function returns:

```{image} images/Passing-immutable-crop.jpg
:alt: variables
:width: 350px
:align: center
```

Once the function is over and the stack frame is gone,
the string object we want (with `moomoo!`) will be inaccessible.
The net effect of this function is nothing at all.
It doesn't change the object that `s` refers to,
it doesn't return anything,
and it has no other effect such as taking user input or printing to the screen.
The one thing it does do, making `s` refer to something new,
doesn't last beyond the function call.

If we want to use this function to change `word`,
the solution is to return the new value and then, in the calling code,
assign that value to `word`:

```python
# Example 4.

def emphasized(s: str) -> str:
    return s + s + '!'

if __name__ == '__main__':
    word = 'moo'
    word = emphasized(word)
    print(word)
```

This code prints out `moomoo!`.
Notice that we changed the function name from
`emphasize` to `emphasized`.
This makes sense when we consider the context of the function call:

```python
    word = emphasized(word)
```

Our function call is not merely performing some action, it is returning a value.
So the expression on the right-hand side has a value: it is the emphasized word.


## Passing a reference to a mutable object

<!--
Wording to possibly use somewhere:

This is really no different than the kinds of side effects we saw earlier
when we learned about aliasing.

Side effects are not a bad thing:
functions are often designed to create side effects.
You just have to know what you're dealing with
(primitive, immutable object, or mutable object)
so you are sure your code will do what you want.
-->

If we wrote code analogous to the broken code in Example 3,
but with a mutable type,
it wouldn't work either.
For example:

```python
# Example 5.

def emphasize(lst: list[str]) -> None:
    lst = lst + ['believe', 'me!']

if __name__ == '__main__':
    sentence = ['winter', 'is', 'coming']
    emphasize(sentence)
    print(sentence)
```

This code prints `['winter', 'is', 'coming']` for the same reason we saw in Example 3.
Changing a reference
(in this case, making `lst` refer to something new)
is not the same as mutating a value
(in this case, mutating the `list` object whose id was passed to the function).
This model of memory illustrates:

```{image} images/Passing-mutable-assignment-crop.jpg
:alt: variables
:width: 600px
:align: center
```

The code below, however, correctly mutates the object:

```python
# Example 6.
def emphasize(lst: list[str]) -> None:
    lst.extend(['believe', 'me!'])

if __name__ == '__main__':
    sentence = ['winter', 'is', 'coming']
    emphasize(sentence)
    print(sentence)
```

This is the state of memory immediately before function `emphasize` returns:

```{image} images/Passing-mutable-crop.jpg
:alt: variables
:width: 450px
:align: center
```

Here are some things to notice:

-   When we begin this program, we are executing the module as a whole.
    We make an initial frame to track its variables, and put the module name in the upper-left corner.
-   When we call `emphasize`, a new frame is added to the call stack.
    In the upper-left corner of the frame, we write the function name.
-   The parameter `lst` exists in the stack frame.
    It comes into being when the function is called.
    And when the function returns, this frame will be discarded, along with everything in it.
    At that point, `lst` no longer exists.
-   When we pass argument `sentence` to `emphasize`,
    we assign it to `lst`.
    In other words, we set `lst` to `id2`, which creates an alias.
-   `id2` is a reference to a `list` object, which is mutable.
    When we use `lst` to access and change that object,
    the object that `sentence` references also changed.
    Of course it does: they are the same object!

## Moral of the story

The situation gets trickier when we have objects that contain references to other objects,
and you'll see examples of this in the work you do this term.
The bottom line is this:
know whether your objects are mutable---at *each* level of their structure.
Memory model diagrams offer a concise visual way to represent that.

# 1.3 The Function Design Recipe

Often when beginners are tasked with writing a program to solve a problem, they jump immediately to writing code.
Doesn't matter whether the code is correct or not, or even if they fully understand the problem: somehow the allure of filling up the screen with text is too tempting.
So before we go further in our study of the Python programming language, we'll introduce the *Function Design Recipe*, a structured process for taking a problem description and designing and implementing a function in Python to solve this problem.

## The Function Design Recipe by example

Consider the following example problem: write a function to determine whether or not a number is even.
We'll use this example to illustrate the five steps of the Function Design Recipe.

### 1. Write example uses

Pick a name for the function (often a verb or verb phrase).
Sometimes a good name is a short answer to the question
鈥淲hat does your function do?鈥� Write one or two examples of calls
to your function and the expected returned values. Include an
example of a standard case (as opposed to a tricky case). Put the
examples inside a triple-quoted string that you鈥檝e indented since
it will be the beginning of the docstring.

```python
    """
    >>> is_even(2)
    True
    >>> is_even(17)
    False
    """
```

### 2. Write the function header

Write the function header above the docstring (not indented).
Choose a meaningful name for each parameter (often nouns).
Include the type contract (the types of the parameters and
return value).

```python
def is_even(value: int) -> bool:
    """
    >>> is_even(2)
    True
    >>> is_even(17)
    False
    """
```

### 3. Write the function description

Before the examples, add a description of what the function does
and mention each parameter by name or otherwise make sure the
purpose of each parameter is clear. Describe the return value.

```python
def is_even(value: int) -> bool:
    """Return whether value is even.
    >>> is_even(2)
    True
    >>> is_even(17)
    False
    """
```

### 4. Implement the function body

Write the body of the function and indent it to match the
docstring. To help yourself write the body, review your examples
from the first step and consider how you determined the return
values. You may find it helpful to write a few more example
calls.

```python
def is_even(value: int) -> bool:
    """Return whether value is even.
    >>> is_even(2)
    True
    >>> is_even(17)
    False
    """
    return value % 2 == 0
```

### 5. Test the function

Test your function on all your example cases including any
additional cases you created in the previous step. Additionally,
try it on extra tricky or corner cases.

One simple way to test your function is by calling it in the
Python console. In the next section, we'll discuss more powerful
ways of testing your code.

If you encounter any errors/incorrect return values, first make
sure that your tests are correct, and then go back to Step 4 and
try to identify and fix any possible errors in your code.
This is called *debugging* your code, a process we'll discuss
throughout this course.

## Next steps

While the Function Design Recipe was taught in CSC108
(and we assume that you will review it on your own time if needed),
we want to expand on some important aspects that will be incorporated more heavily in this course:
preconditions in the function docstring, type contracts, and, in the next chapter, testing methodologies.

# 1.4 Preconditions

One of the most important purposes of a function docstring is to let others know how to use the function.
After all, we don't just write code for ourselves, but for other members of our development team or company,
or even the world at large if we're writing a library we think is useful to anyone.

The docstring of a function describes not only what the function does---through text and examples---but also the requirements necessary to use the function.
One such requirement is the **type contract**: this requires that when someone calls
the function, they do so with arguments of a specified type.

For example, given this function docstring:

```python
def decreases_at(numbers: list[int]) -> int:
    """Return the index of the first number that is less than its predecessor.

    >>> decreases_at([3, 6, 9, 12, 2, 1, 8, 5])
    4
    """
```

We know that `decreases_at` expects to be called on a list of integers;
if we violate the type contract, say by calling it on a single integer or a
dictionary, we cannot expect it to work properly.

In practice, we often want to extend this idea beyond specifying the required type of arguments.
For example, we might want to say that "this function must be given numbers between 1 and 10" or
"the first argument must be greater than the second argument."
A **precondition** of a function is any property that the function's arguments must satisfy to ensure that the function works as described.
They are included in a function's docstring, and form a crucial part of the function's interface.

As a user of a function, preconditions are extremely important, since they tell you what you have to do to use the function properly. They *limit* how a function can be used.
On the flip side, preconditions are freeing to the implementor of a function: by specifying a certain property in a precondition, the person writing the body of the function can go ahead and *assume* that this property is satisfied, which often leads to a simpler or more efficient implementation.
Consider a method for searching a list.
Binary search is efficient, but depends on having a sorted list.
If the search method had to confirm this,
the added work would make it slower than linear search!
In this case, it makes sense to simply require the caller to provide a sorted list.

The bottom line is that specifying preconditions is part of the *design* of a function.
It is a matter of specifying precisely what service we want to provide to the users of our functions---and what restrictions we want to impose upon them.

## How can we check preconditions?

While our previous example illustrates how to document preconditions as part of a function specification, it has one drawback: it relies on whoever is calling the function to read the documentation!
Of course, reading documentation is an important skill for any computer scientist, but despite our best intentions we sometimes miss things.
It would be nice if we could turn our preconditions into executable Python code so that the Python interpreter checks them every time we call the function.

For the rest of this section, we'll use the following function as our running example.
Note that in addition to the parameter type annotation, we've included a precondition written in the function docstring.

```python
def max_length(strings: list[str]) -> int:
    """Return the maximum length of a string in the given list of strings.

    Preconditions:
      - strings != []
    """
    max_so_far = -1
    for s in strings:
        if len(s) > max_so_far:
            max_so_far = len(s)

    return max_so_far
```

## Checking preconditions with assertions

One way to do this is to use an `assert` statement.
Because we've written the precondition as a Python expression, we can convert this to an assertion by copy-and-pasting it at the top of the function body.

```python
def max_length(strings: list[str]) -> int:
    """Return the maximum length of a string in the given list of strings.

    Preconditions:
      - strings != []
    """
    assert strings != []  # Check the precondition

    max_so_far = -1
    for s in strings:
        if len(s) > max_so_far:
            max_so_far = len(s)

    return max_so_far
```

Now, the precondition is checked every time the function is called, with a meaningful error message when the precondition is violated:

```pycon
>>> empty_list = []
>>> max_length(empty_list)
Traceback (most recent call last):
  File "<input>", line 1, in <module>
  File "<input>", line 7, in max_length
AssertionError
```

We can even improve the error message we get by using an extended syntax for `assert` statements, where we include a string message to display after the boolean expression being checked:

```python
def max_length(strings: list[str]) -> int:
    """Return the maximum length of a string in the given list of strings.

    Preconditions:
      - strings != []
    """
    assert strings != [], 'Precondition violated: max_length called on an empty list.'

    max_so_far = -1
    for s in strings:
        if len(s) > max_so_far:
            max_so_far = len(s)

    return max_so_far
```

Calling `max_length` on an empty set raises the same `AssertionError` as before, but now displays a more informative error message:

```pycon
>>> empty_list = []
>>> max_length(empty_list)
Traceback (most recent call last):
  File "<input>", line 1, in <module>
  File "<input>", line 7, in max_length
AssertionError: Precondition violated: max_length called on an empty list.
```

However, this approach of copy-and-pasting preconditions into assertions is tedious and error-prone.
First, we have to duplicate the precondition in two places.
And second, we have increased the size of the function body with extra code.
And worst of all, both of these problems increase with the number of preconditions!
*There must be a better way.*

## Enter PythonTA

The `python_ta` library we use in this course has a way to automatically check preconditions for all functions in a given file.
Here is an example:

```python
from python_ta.contracts import check_contracts  # NEW


@check_contracts  # NEW
def max_length(strings: list[str]) -> int:
    """Return the maximum length of a string in the given list of strings.

    Preconditions:
      - strings != []
    """
    max_so_far = -1
    for s in strings:
        if len(s) > max_so_far:
            max_so_far = len(s)

    return max_so_far
```

Notice that we've kept the function docstring the same, but removed the assertion.
Instead, we are importing a new module (`python_ta.contracts`), and then using the `check_contracts` from that module as a... what? 馃

The syntax `@check_contracts` is called a **decorator**, and is technically a form of syntax that is an *optional part of a function definition* that goes immediately above the function header.
We say that the line `@check_contracts` *decorates* the function `max_length`, which means that it adds additional behaviour to the function beyond what is written the function body.

So what is this "additional behaviour" added by `check_contracts`?
As you might imagine, it reads the function's type contract and the preconditions written in the function docstring, and causes the function to check these preconditions every time `max_length` is called.
Let's see what happens when we run this file in the Python console, and attempt to call `max_length` on an empty set:

```pycon
>>> empty_list = []
>>> max_length(empty_list)
Traceback (most recent call last):
  ...  # File location details omitted
AssertionError: max_length precondition "strings != []" was violated for arguments {strings: []}
```

Pretty cool!
And moreover, because all parameter type annotations are preconditions, `python_ta` will also raise an error if an argument does not match a type annotation.
Here's an example of that:

```pycon
>>> max_length(148)
Traceback (most recent call last):
  ...  # File location details omitted
AssertionError: max_length argument 148 did not match type annotation for parameter strings: list[str]
```

We'll be using PythonTA's `check_contracts` decorator throughout this course to help us make sure we're sticking to the specifications we've written in our function header and docstrings when we call our functions.
Moreover, `check_contracts` checks the return type of each function, so it'll also work as a check when we're implementing our functions to make sure the return value is of the correct type.

# 1.5 Python Type Annotations

In many programming languages, we cannot use a variable until we
have declared its type, which determines the values that can be assigned to it;
furthermore, a variable's type can never change.
Python takes a very different approach:
only *objects* have a type, not the variables that refer to those objects; and in fact, a variable can refer to any type of object.
Nonetheless, we can't use a Python variable unless we know what type of object
it refers to at the moment---how would we know what we can do with it?

Since we need to be aware of the types we are using at any point in our code,
it is good practise to document this.
In this course, we will document the types of all *functions* and class *instance attributes*.
We'll use Python's type annotation syntax to do so.

Before we can begin documenting types, we need to learn how to name them.


## Primitive types

For primitive types, we can just use their type names.
The table below gives the names of the common primitive types that are built into Python.
There are other built-in types that are omitted because we tend not to use them in this course.

| Type name | Sample values     |
|-----------|-------------------|
| `int`       | `0`, `148`, `-3`        |
| `float`     | `4.53`, `2.0`, `-3.49`  |
| `str`       | `'hello world'`, `''` |
| `bool`      | `True`, `False`       |
| `None`      | `None`              |

Note that `None` is a bit special, as we refer to it as both a value and the name of its type.


## Compound types

For compound types like lists, dictionaries, and tuples, we can also just use
their type names: `list`, `dict`, and `tuple`.[^1]
But often we need to be more specific.
For example, often we want to say that a function takes in not just any list,
but only a list of integers;
we might also want to say that this function returns not just any tuple,
but a tuple containing one string and one boolean value.

We can use *square brackets* to express the "contained" types for each of these compound types.
The table below shows examples of this syntax for each type;
the capitalized words in square brackets could be substituted with any type.

| Type                 | Description                                                                   | Example                                                   |
|----------------------|-------------------------------------------------------------------------------|-----------------------------------------------------------|
| `list[T]`            | a list whose elements are all of type `T`                                     | `[1, 2, 3]` has type `list[int]`                          |
| `dict[T1, T2]`       | a dictionary whose keys are of type `T1` and whose values are of type `T2`    | `{'a': 1, 'b': 2, 'c': 3}` has type `dict[str, int]`      |
| `tuple[T1, T2, ...]` | a tuple whose first element has type `T1`, second element has type `T2`, etc. | `('hello', True, 3.4)` has type `tuple[str, bool, float]` |


We can nest these type expressions within each other;
for example, the nested list `[[1, 2, 3], [-2]]` has type `list[list[int]]`.

Sometimes we want to be flexible and say that a value must be a list,
but we don't care what's in the list
(e.g. it could be a list of strings, a list of integers, a list of strings mixed with integers, etc.).
In such cases,
we can simply use the built-in types `list`, `dict`, and `tuple` for these types.


## Annotating functions

Now that we know how to name the various types,
let's see how we can use this to annotate the type of a function.

Suppose we have the following function:

```python
def can_divide(num, divisor):
    """Return whether num is evenly divisible by divisor."""
    return num % divisor == 0
```

This function takes in two integers and returns a boolean.
We annotate the type of a function parameter by writing a colon and type after it:

```python
def can_divide(num: int, divisor: int):
```

We annotate the return type of the function by writing an arrow and type after the close parenthesis, and before the final colon:

```python
def can_divide(num: int, divisor: int) -> bool:
```

We can use any of the type expressions discussed above in these function type annotations, including types of lists and dictionaries.

```python
def split_numbers(numbers: list[int]) -> tuple[list[int], list[int]]:
    """Return a tuple of lists, where the first list contains the numbers
    that are >= 0, and the second list contains the numbers that are < 0.
    """
    pos = []
    neg = []
    for n in numbers:
        if n >= 0:
            pos.append(n)
        else:
            neg.append(n)
    return pos, neg
```


## Annotating instance attributes

To annotate the instance attributes of a class, we list each attribute along with its type directly in the body of the class.
By convention, we usually list these at the very top of the class, after the class docstring and before any methods.

```python
class Inventory:
    """The inventory of a store.

    Keeps track of all of the items available for sale in the store.

    Attributes:
        size: the total number of items available for sale.
        items: a dictionary mapping an id number to a tuple with the
            item's description and number in stock.
    """
    size: int
    items: dict[int, tuple[str, int]]

    ...  # Methods omitted
```

## Annotating methods

Annotating the methods of a class is the same as annotating any other function,
with two notable exceptions:

1.  By convention, we do not annotate the first parameter `self`.
    Its type is always understood to be the class that this method belongs to.
2.  Sometimes we need to refer to the class itself, because it is the type of
    some other parameter or the return type of a method.
    Because of a quirk of Python, we can only do so by including a special import statement
    at the very top of our Python file.

Here is an example (for brevity, method bodies are omitted):

```python
# This is the special import we need for class type annotations.
from __future__ import annotations


class Inventory:

    # The type of self is omitted.
    def __init__(self) -> None:
        ...
    def add_item(self, item: str, quantity: int) -> None:
        ...
    def get_stock(self, item: str) -> int:
        ...

    def compare(self, other: Inventory) -> bool:
        ...
    def copy(self) -> Inventory:
        ...
    def merge(self, others: list[Inventory]) -> None:
        ...
```


## Four advanced types

Here are four more advanced types that you will find useful throughout the course.
The first two use a special syntax, `|` in the type annotation.
The latter two are types imported from the built-in `typing` module.

### Two or more possible types

We sometimes want to express in a type annotation
that a value could be one of two different types; for example, we might say that a function can take in either an integer or a float.
To do so, we use the vertical bar `|` ("union") to separate the type names.
For example, the type annotation `int | float` represents the type of a value that could be either an `int` or a `float`.

```python
def cube_root(x: int | float) -> float:
    return x ** (1 / 3)
```

### A type or `None`

One of the most common uses of the `|` is to say that a value could be a certain type, or `None`.
For example, we might say that a function returns an integer or `None`, depending on some success or failure condition.
For all type expressions `<T>`, we can write `<T> | None` to express this.
Here is an example:

```python
def find_pos(numbers: list[int]) -> int | None:
    """Return the first positive number in the given list.

    Return None if no numbers are positive.
    """
    for n in numbers:
        if n > 0:
            return n
```


### `Any`

Sometimes we want to specify the that the type of a value could be anything (e.g., if we're writing a function that takes a list of any type and returns its first element).
We annotate such types using `Any`, which is imported from the `typing` module.

```python
from typing import Any


# This function could return a value of any type
def get_first(items: list) -> Any:
    return items[0]
```

*Warning*: beginners often get lazy with their type annotations, and tend to write `Any` even when a more specific type annotation is appropriate.
While this will cause code analysis tools (like PyCharm or `python_ta`) to be satisfied and not report errors,
overuse of `Any` completely defeats the purpose of type annotations!
Remember that we use type annotations as a form of *communication*, to tell other programmers how to use our function or class.
With this goal in mind, we should always prefer giving specific type annotations to convey the most information possible, and only use `Any` when absolutely necessary.

*Note*: Many Python type checkers interpret `Any` as including the possibility of a `None` value.
However, for educational purposes in this course, we will use the type annotation `Any | None` to explicitly indicate when a value can be of any type, including `None`.
When we write `Any` by itself, we'll mean "any non-`None` type".


### Callable

Finally,
we sometimes need to express that
the type of a parameter, return value, or instance attribute is itself a function.
To do so, we use the `Callable` type from the `typing` module.
This type takes two expressions in square brackets:
the first is a list of types,
representing the types of the function's arguments;
the second is its return type.
For example, the type `Callable[[int, str], bool]`
is a type expression for a function that
takes two arguments, an integer and a string, and returns a boolean.
Below, the type annotation for `compare_nums`
declares that it can take any function that takes two integers and returns a boolean:

```python
from typing import Callable


def compare_nums(num1: int, num2: int,
                 comp: Callable[[int, int], bool]) -> int:
    if comp(num1, num2):
        return num1
    else:
        return num2


def is_twice_as_big(num1: int, num2: int) -> bool:
    return num1 >= 2 * num2


>>> compare_nums(10, 3, is_twice_as_big)
10
>>> compare_nums(10, 6, is_twice_as_big)
6
```

[^1]: In previous versions of Python (and offerings of CSC148), we had to use type annotations `List`, `Dict`, and `Tuple` imported from the `typing` module. But now that's no longer necessary, and we can use the built-in `list`, `dict`, and `tuple` in type annotations instead.

