# 6.1 Introduction to Linked Lists

We have seen that
Python lists are an array-based implementation of the list ADT
and that they have some drawbacks:
inserting and deleting items in a list can require shifting many elements in the program's memory.
For example, we saw that inserting and deleting at the *front* of a built-in list
takes time proportional to the length of the list,
because every item in the list needs to be shifted by one spot.

This week, we're going to study a completely different implementation of the List ADT
that will attempt to address this efficiency shortcoming.
To do so, we'll use a new data structure called the **linked list**.
Our goal will be to create a new Python class that behaves exactly the same as the built-in `list` class,
changing only what goes on in the private implementation of the class.
This will mean that, ultimately, code such as this:

```python
for i in range(n):
    nums.append(i)
print(nums)
```

will work whether `nums` is a Python `list` or an instance of the class we are going to write.
We'll even learn how to make `list` indexing such as `nums[3] = 'spider'` work on instances of our class!


## The concept of "links"

The reason why a Python `list` often requires elements to be shifted back and forth
is that the elements of a Python `list` are stored in contiguous slots in memory.
What if we didn't attempt to have this contiguity?
If we had a variable referring to the first element of a list,
how would we know where the rest of the elements were?
We can solve this easily, if we store along with each element a reference to the next element in the list.

This bundling of data---an element plus a reference to the next element--should suggest something familiar to you: the need for a new *class* whose instance attributes are exactly these pieces of data.
We'll call this class a *node*, and implement it in Python as follows:[^1]

```python
class _Node:
    """A node in a linked list.

    Note that this is considered a "private class", one which is only meant
    to be used in this module by the LinkedList class, but not by client code.

    Attributes:
    - item:
        The data stored in this node.
    - next:
        The next node in the list, or None if there are no more nodes.
    """
    item: Any
    next: _Node | None

    def __init__(self, item: Any) -> None:
        """Initialize a new node storing <item>, with no next node.
        """
        self.item = item
        self.next = None  # Initially pointing to nothing
```

An instance of `_Node` represents a *single element* of a list;
to represent a list of *n* elements, we need *n* `_Node` instances.
The references in all of their `next` attributes link the nodes together into a sequence,
even though they are not stored in consecutive locations in memory,
and of course this is where linked lists get their name.

<!-- Here's what it might look like if we had two `_Node` objects linked together:
**TODO: insert image.**
Not sure whether to use 10 and 20 as the elements,
as below, and whether to include a reference to the first or both first and second.
Don't want to be confusing vs the by-hand example below. -->

## A `LinkedList` class

The second class we'll use in our implementation
is a `LinkedList` class, which will represent the list itself.
This class is the one we want client code to use, and
in it we'll implement methods that obey the same interface as the built-in `list` class.

Our first version of the class has a very primitive initializer that always creates an empty list.

```python
class LinkedList:
    """A linked list implementation of the List ADT.

    Private Attributes:
    - _first: The first node in this linked list, or None if this list is empty.
    """
    _first: _Node | None

    def __init__(self) -> None:
        """Initialize an empty linked list.
        """
        self._first = None
```


## Example: building links

Of course, in order to do anything interesting with linked lists, we need to be able to create arbitrarily long linked lists!
We'll see more sophisticated ways of doing this later, but for practice here we'll violate privacy concerns and just manipulate the private attributes directly.

```python
>>> linky = LinkedList()  # linky is empty
>>> print(linky._first)
None
>>> node1 = _Node(10)   # New node with item 10
>>> node2 = _Node(20)   # New node with item 20
>>> node3 = _Node(30)   # New node with item 30
>>> print(node1.item)
10
>>> print(node1.next)   # New nodes don't have any links
None
>>> node1.next = node2  # Let's set some links
>>> node2.next = node3
>>> node1.next is node2 # Now node1 refers to node2!
True
>>> print(node1.next)
<_Node object at 0x000000000322D5F8>
>>> print(node1.next.item)
20
>>> print(node1.next.next.item)
30
>>> linky._first = node1   # Finally, set linky's first node to node1
>>> linky._first.item      # linky now represents the list [10, 20, 30]
10
>>> linky._first.next.item
20
>>> linky._first.next.next.item
30
```

The most common mistake students make when first starting out with linked lists is confusing an individual node object with the item it stores.
So in the example above, there's a big difference between `node1` and `node1.item`: the former is a `_Node` object containing the number 10, while the latter *is* the number 10 itself!

As you start writing code with linked lists, you'll sometimes want to operate on nodes, and sometimes want to operate on items. Making sure you always know exactly which type you're working with is vital to your success here.


## Linked list diagrams

Because each element of a linked list is wrapped in a `_Node` object,
complete memory model diagrams of linked lists are quite a bit larger than those corresponding to Python's array-based lists.
For example, the following is a diagram showing a linked list named `linky` with four elements, in order `109, 68, 71, 3`.

![Linked list memory model diagram.](images/linked-list-full-mm-crop.jpg)

While memory model diagrams are always a useful tool for understanding subtle memory errors---which certainly come up with linked lists!---they can be overkill if you want a quick and dirty linked list diagram.
So below we show two stripped down versions of the memory model diagram, which remove all of the "boilerplate" type and attribute names.
The first one keeps the "item" references as arrows to separate memory objects, while the second goes a step further in simplification by writing the numbers directly in the node boxes.

![Linked list abstract diagrams.](images/linked-list-abstract-crop.jpg)

[^1]: We use a preceding underscore for the class name to indicate that this entire class is *private*: it shouldn't be accessed by client code directly, but instead is only used by the "main" class described in the next section.

# 6.2 Traversing Linked Lists

The final example in the previous section ended with the sequence of expressions `linky._first.item`, `linky._first.next.item`, and `linky._first.next.next.item` to access the linked list's first, second, and third elements, respectively.
This is, of course, a very cumbersome way of accessing list elements!
In this section, we'll study how to *traverse* a linked list: that is, how to write code that visits each element of a linked list one at a time, regardless of how long that linked list actually is.
The basic structure of this code is quite general,
so we will apply it to a bunch of different methods.
This may seem repetitive, but linked list code is one of the most technically challenging and important parts of the course, so spend the time to master it!

Before we write code to traverse a linked list,
let's remember how traversal might look for a built-in list,
manually using an index variable `i` to keep track of where we are in the list.[^1]

```python
i = 0
while i < len(my_list):
    ... do something with my_list[i] ...
    i = i + 1
```

This code segment consists of four parts:

1. Initialize the index variable `i` (0 refers to the start of the list).
2. Check if we've reached the end of the list.
3. Do something with the current element `my_list[i]`.
4. Increment the index.

This method takes advantage of the fact that Python already gives us a way to access elements of a built-in list by index (using square brackets).
In a linked list, we don't have this luxury, and so the major difference to this pattern is that we now keep a variable that refers to which `_Node` object we're on in the loop.
Traversing a linked list consists of the exact same steps, except that the temporary variable now refers to a particular `_Node` object rather than an index.
Other than this change, the steps are exactly the same!

```python
curr = my_linked_list._first   # 1. Initialize curr to the start of the list
while curr is not None:        # 2. curr is None if we've reached the end of the list.
    ... curr.item ...          # 3. Do something with the current *element* curr.item.
    curr = curr.next           # 4. "Increment" curr, setting it to refer to the next node.
```

For example, here is a `LinkedList` method that prints out every item in a linked list.

```python
class LinkedList:
    def print_items(self) -> None:
        """Print out each item in this linked list."""
        curr = self._first
        while curr is not None:
            print(curr.item)      # Note: this is the only line we needed to fill in!
            curr = curr.next
```

And here is a `LinkedList` method that's a bit more complicated but uses the same traversal template.
The goal of this method is to convert a linked list into a built-in Python list, in a non-mutating fashion (i.e., by returning a Python list without changing the original list).

```python
    def to_list(self) -> list:
        """Return a (built-in) list that contains the same elements as this list.
        """
        items = []
        curr = self._first
        while curr is not None:
            items.append(curr.item)
            curr = curr.next

        return items
```


## Our philosophy for "code templates"

You might be surprised about our presentation of a code template for traversing a linked list.
After all, aren't templates bad---we shouldn't just copy-and-paste code, right?

But in fact, over the next few weeks of the course, we'll *encourage* you to use certain code templates to help get started writing and organizing your code.
The difference between these code templates and just regular copy-and-pasting of code is that these templates are meant only to provide an overall code structure, and not replace the hard work of actually thinking about how to write code.
In other words, we use templates to make it easier to *get started* writing code.

Consider again our template for iterating through a linked list:

```python
curr = my_linked_list._first
while curr is not None:
    ... curr.item ...
    curr = curr.next
```

Whenever you're starting to write code to iterate through a linked list, your *first* step
should be to copy-and-paste this template into your code.
But that's the easy part; the next part involves the thinking required to fill in the ellipsis (`...`)
and modify the template to suit your particular needs.
In the following weeks of this course, you'll get lots of practice with that. 馃榾

[^1]: The following code is written to be a nice lead-in to linked list traversal;
    please keep in mind that there are better ways of iterating through a `list` in Python!

# 6.3 Linked List Mutation

All of the linked list methods we have looked at so far are *non-mutating*, meaning they did not change the linked list upon which they were called.
Here's a reminder of the basic traversal pattern using a `while` loop: understanding this is critical before moving on!

```python
# self is a LinkedList
curr = self._first
while curr is not None:
    ... curr.item ...
    curr = curr.next
```

We started with these methods because they're generally easier to understand than their mutating cousins.
Now, we're going to look at the two major **mutating** operations on linked lists: inserting into and deleting items from a linked list.
We'll start with the simplest version of this: appending a new item to the end of a linked list.
Before we start, let's remind ourselves how this works for built-in lists:

```python
>>> lst = []
>>> lst.append(1)
>>> lst.append(2)
>>> lst.append(3)
>>> lst
[1, 2, 3]
```

## Linked list `append`

```python
class LinkedList:
    def append(self, item: Any) -> None:
        """Add the given item to the end of this linked list."""
```

Recall that a `LinkedList` object has only one attribute, a reference to the *first* node in the list.
Unfortunately, this means that we have some work to do to implement `append`: before adding the item, we need to find the currently last node in the linked list, and then add the item to the end of that.
Let's start (as recommended!!) by using our basic code template:

```python
    def append(self, item: Any) -> None:
        """Add the given item to the end of this linked list."""
        curr = self._first
        while curr is not None:
            ... curr.item ...
            curr = curr.next
```

This template is a good start, but now our thinking must begin.
First: what do we do with `curr.item`?
The answer is "Nothing!"---we don't need to actually use any of the existing items in the list, and instead are just going through the list to get to the last node.
Unfortunately, there's a problem with the loop: this loop is designed to keep going until we've processed all of the elements of the list, and `curr` becomes `None`.
But this is actually going too far for our purposes: we want to stop the loop as soon as we reach the last node.[^1]
We modify our loop condition to check whether the current node is the last one by using `curr.next is None` instead.

```python
    def append(self, item: Any) -> None:
        """Add the given item to the end of this linked list."""
        curr = self._first
        while curr.next is not None:
            curr = curr.next

        # After the loop, curr is the last node in the LinkedList.
        # assert curr is not None and curr.next is None
```

At this point, the astute reader will point out a flaw in this change: we aren't guaranteed that `curr` starts off as a node---it could be `None`.
But because we don't want to get bogged down with handling that case right now, we'll add a TODO comment in our code and keep going.

```python
    def append(self, item: Any) -> None:
        """Add the given item to the end of this linked list."""
        curr = self._first
        while curr.next is not None:   # TODO: what if curr starts off as None?
            curr = curr.next

        # After the loop, curr is the last node in the LinkedList.
        # assert curr is not None and curr.next is None
```

So then after the loop ends, we know that `curr` refers to the last node in the linked list, and we are finally in a position to add the given item to the linked list.
To do so, we need to create a new node and then connect it in.

```python
    def append(self, item: Any) -> None:
        """Add the given item to the end of this linked list."""
        curr = self._first
        while curr.next is not None:   # TODO: what is curr starts off as None?
            curr = curr.next

        # After the loop, curr is the last node in the LinkedList.
        # assert curr is not None and curr.next is None
        new_node = _Node(item)
        curr.next = new_node
```

And finally, let's handle that TODO.
We know from the documentation of our `LinkedList` class that `self._first` can only be `None` if `self` refers to an empty linked list.
But in this case, all we need to do is add the new item to be the first item in the linked list.

```python
    def append(self, item: Any) -> None:
        """Add the given item to the end of this linked list."""
        curr = self._first
        if curr is None:
            new_node = _Node(item)
            self._first = new_node
        else:
            while curr.next is not None:
                curr = curr.next

            # After the loop, curr is the last node in the LinkedList.
            # assert curr is not None and curr.next is None
            new_node = _Node(item)
            curr.next = new_node
```

### Example: a more general initializer

With our `append` method in place, we can now stop creating linked lists by manually fiddling with attributes, and instead modify our linked list initializer to take in a list of values, which we'll then append one at a time:

```python
class LinkedList:
    def __init__(self, items: list) -> None:
        """Initialize a new linked list containing the given items.

        The first node in the linked list contains the first item
        in <items>.
        """
        self._first = None
        for item in items:
            self.append(item)
```

While this code is perfectly correct, it turns out that it is rather inefficient; we'll leave it as an exercise for now to develop a better approach.


## Index-based insertion

Now suppose we want to implement a more general form of insertion that allows the user to specify the index of the list to insert a new item into (analogous to the built-in `list.insert` method):

```python
class LinkedList:
    def insert(self, index: int, item: Any) -> None:
        """Insert a new node containing item at position <index>.

        Precondition: index >= 0.

        Raise IndexError if index > len(self).

        Note: if index == len(self), this method adds the item to the end
        of the linked list, which is the same as LinkedList.append.

        >>> lst = LinkedList([1, 2, 10, 200])
        >>> lst.insert(2, 300)
        >>> str(lst)
        '[1 -> 2 -> 300 -> 10 -> 200]'
        >>> lst.insert(5, -1)
        >>> str(lst)
        '[1 -> 2 -> 300 -> 10 -> 200 -> -1]'
        """
```

As with `append`, our first step is to traverse the list until we reach the correct index; and if we want the node to be inserted into position `index`, we need to access the node at position `(index-1)`!
To write the code, we need to modify our code template to store not just the current node, but the current index of that node as well:

```python
def insert(self, index: int, item: Any) -> None:
    curr = self._first
    curr_index = 0

    while curr is not None and curr_index < index - 1:
        curr = curr.next
        curr_index += 1
```

This loop condition is a bit more complicated, so it's worth spending some time to unpack.
Here, we're saying that the loop should keep going when the current node is not `None` *and* when the current index is less than our target index (`index - 1`).
This means that when the loop is over, the current node is `None` *or* the current index has reached the target index (or both!).
We therefore need to structure our code into two cases, and handle each one separately:

```python
    def insert(self, index: int, item: Any) -> None:
        curr = self._first
        curr_index = 0

        while curr is not None and curr_index < index - 1:
            curr = curr.next
            curr_index += 1

        # assert curr is None or curr_index == index - 1
        if curr is None:
            pass
        else: # curr_index == index - 1
            pass
```

Now, if `curr` is `None` then the list doesn't have a node at position `index - 1`, and so that index is out of bounds.
In this case, we should raise an `IndexError`.

On the other hand, if `curr` is not `None`, then we've reached the desired index, and can insert the new node using the same strategy as `append`.

```python
    def insert(self, index: int, item: Any) -> None:
        curr = self._first
        curr_index = 0

        while curr is not None and curr_index < index - 1:
            curr = curr.next
            curr_index += 1

        # assert curr is None or curr_index == index - 1
        if curr is None:
            # index - 1 is out of bounds. The item cannot be inserted.
            raise IndexError
        else: # curr_index == index - 1
            # index - 1 is in bounds. Insert the new item.
            new_node = _Node(item)
            curr.next = new_node  # Hmm...
```

Well, almost. The problem with the last `else` branch is that unlike `append`, `curr` might have had other nodes after it!
Simply setting `curr.next = new_node` loses the reference to the old node at position `index`, and any subsequent nodes after that one.
So before overwriting `curr.next`, we need to update `new_node` so that it refers to the old node at position `index`:

```python
    def insert(self, index: int, item: object) -> None:
        curr = self._first
        curr_index = 0

        while curr is not None and curr_index < index - 1:
            curr = curr.next
            curr_index += 1

        # assert curr is None or curr_index == index - 1
        if curr is None:
            # index - 1 is out of bounds. The item cannot be inserted.
            raise IndexError
        else: # curr_index == index - 1
            # index - 1 is in bounds. Insert the new item.
            new_node = _Node(item)
            new_node.next = curr.next  # THIS LINE IS IMPORTANT!
            curr.next = new_node
```

### Warning! Common error ahead! (and solution)

When writing mutating methods on linked lists, we very often update the links of individual nodes to add and remove nodes in the list.
We must be very careful when doing so, because the order in which we update the links really matters, and often only one order results in the correct behaviour.

For example, this order of link updates in the final `else` branch doesn't work:

```python
curr.next = new_node
new_node.next = curr.next
```

On the second line, `curr.next` has already been updated, and its old value lost. The second line is now equivalent to writing `new_node.next = new_node`, which is certainly not what we want!

The reason this type of error is so insidious is that the code *looks* very similar to the correct code (only the order of lines is different), and so you can only detect it by carefully tracing through the updates of the links line-by-line.

To mitigate this problem, we'll take advantage of a pretty nice Python feature known as *multiple* (or *simultaneous*) *assignment*:

```python
a, b = 1, 2  # Assigns 1 to a and 2 to b
```

The beauty of this approach is that the expressions on the right side are *all* evaluated before any new values are assigned, meaning that you don't need to worry about the order in which you write them.
For example, these two assignment statements are *equivalent*:

```python
# Version 1
curr.next, new_node.next = new_node, curr.next
# Version 2
new_node.next, curr.next = curr.next, new_node
```

In other words, using multiple assignment in this linked list method allows us to ignore the tricky business about the order in which the link updates happen!
We strongly recommend using multiple assignment in your own code when working with complex state updating.


### Tidying up: don't forget about corner cases!

Our `insert` implementation has one problem: what if `index = 0`?
In this case, it doesn't make sense to iterate to the (`index-1`)-th node!
This is again a special case which we need to handle separately, by modifying `self._first` (because in this case, we're inserting into the front of a linked list):

```python
    def insert(self, index: int, item: Any) -> None:
        if index == 0:
            new_node = _Node(item)
            self._first, new_node.next = new_node, self._first
        else:
            curr = self._first
            curr_index = 0

            while curr is not None and curr_index < index - 1:
                curr = curr.next
                curr_index += 1

            # assert curr is None or curr_index == index - 1
            if curr is None:
                # index - 1 is out of bounds. The item cannot be inserted.
                raise IndexError
            else: # curr_index == index - 1
                # index - 1 is in bounds. Insert the new item.
                new_node = _Node(item)
                curr.next, new_node.next = new_node, curr.next
```


## Exercise: Index-based deletion

The analogue of Python's `list.append` is `list.pop`, which allows the user to *remove* an item at a specified index in a list.
Because this is quite similar to insertion, we won't develop the full code here,
but instead outline the basic steps in some pseudo-code:

```python
class LinkedList:
    def pop(self, index: int) -> Any:
        """Remove and return node at position <index>.

        Precondition: index >= 0.

        Raise IndexError if index >= len(self).

        >>> lst = LinkedList([1, 2, 10, 200])
        >>> lst.pop(2)
        10
        >>> lst.pop(0)
        1
        """
        # Warning: the following is pseudo-code, not valid Python code!

        # 1. If the list is empty, you know for sure that index is out of bounds...
        # 2. Else if index is 0, remove the first node and return its item.
        # 3. Else iterate to the (index-1)-th node and update links to remove
        #    the node at position index. But don't forget to return the item!
```


<!--
Note: an additional exercise on Lab 5.
## Exercises

1.  Most list methods, including `__getitem__` and `insert`, allow you to pass in a negative index to start counting from the end of the list (using -1 refer to the last list element).
    Investigate this behaviour of Python lists, and modify the corresponding linked list methods to replicate this behaviour. Don't forget to update the docstrings! -->

[^1]: This is actually a subtle instance of the classic "off-by-one" error in computer science: our iteration goes for one too few times.

# 6.4 Linked Lists and Running Time

To wrap up the discussion of linked lists, we return to our original motivation to studying linked lists: improving the efficiency of some of the basic list operations.

We have already discussed the running time of three operations of array-based lists:

-   Looking up an element of the list by its index (e.g., `lst[i]`) takes *constant time*, i.e., is independent of the length of the list, or even which index we're looking up.
    In the language of Big-Oh notation, we write $O(1)$ to represent this time.
-   Inserting or removing an element at index $i$ ($0 \leq i < n$) in a list of length $n$ takes time proportional to $n - i$, which is the number of list elements that need to be shifted when this operation occurs.
    Remember that Big-Oh notation is used to describe "proportional to" relationships, and so we write that this operation takes time $O(n - i)$.

    In particular, if we only consider inserting/removing at the *front* of an array-based list (so $i = 0$), this takes time linear in the length of the list: $O(n)$.
    On the other hand, if we only consider inserting/removing at the *end* of such a list ($i = n$), this is a constant time operation: $O(1)$.[^1]


## Turning to linked lists

What about the corresponding operations for `LinkedList`?
Let's study our code for `LinkedList.insert`, first looking at the special cases of inserting into the front and end of a linked list.

```python
def insert(self, index: int, item: Any) -> None:
    # Create a new node
    new_node = _Node(item)

    # Need to do something special if we insert into the first position.
    # In this case, self._first *must* be updated.
    if index == 0:
        new_node.next = self._first
        self._first = new_node
    else:
        # Get the node at position (index - 1)
        curr_index = 0
        curr = self._first
        while curr is not None and curr_index < index - 1:
            curr = curr.next
            curr_index = curr_index + 1

        if curr is None:
            raise IndexError
        else:
            # At this point, curr refers to the node at position (index - 1)
            curr.next, new_node.next = new_node, curr.next
```

We insert into the front of the linked list by calling `insert` with an index argument of 0.
In this case, the `if` branch executes, which takes constant time---
both assignment statements do not depend on the length of the list.

On the other hand, suppose we want to insert an item at the end of the linked list,
and there's at least one element already in the linked list.
The `else` branch executes, and the loop must iterate until it reaches the end of the list,
which takes time linear in the length of the list.[^2]

In other words, linked lists have the exact opposite running times as array-based lists for these two operations!
Inserting into the *front* of a linked list takes $O(1)$ time,
and inserting into the *back* of a linked list takes $O(n)$ time,
where $n$ is the length of the list.

This may seem disappointing, because now it isn't clear which list implementation is "better."
But in fact this is pretty typical of computer science:
when creating multiple implementations of a public interface,
each implementation will often be good at some operations, but worse at others.
In practice, it is up to the programmer who is acting as a *client* of the interface to decide which implementation to use, based on how they prioritize the efficiency of certain operations over others.


## Investigating the subtleties of "input size"

Despite our discussion above, we haven't yet finished the analysis of linked list `insert`.
We've really only looked at two special cases: when `index` is 0, and when `index` is the length of the linked list.
What about all the other numbers?

The *very first* thing we need to look at is the running of each individual line of code.
In this case, each individual line (like `curr = self._first`) takes *constant time*, i.e., doesn't depend on the size of the inputs.
This means that the overall running time depends on the number of lines that execute, and this in turn depends on the number of times the loop runs.

```python
curr_index = 0
curr = self._first
while curr is not None and curr_index < index - 1:
    curr = curr.next
    curr_index = curr_index + 1
```

So how many times does the loop run? There are two possibilities for when it stops: when `curr is None`, or when `curr_index == index - 1`.

- The first case means that the end of the list was reached, which happens after `n` iterations, where `n` is the length of the list (each iteration, the `curr` variable advances by one node).
- The second case means that the loop ran `index - 1` times, since `curr_index` starts at 0 and increases by 1 per iteration.

Since the loop stops when one of the conditions is false, the number of iterations is the *minimum* of these two possibilities: $min(n, index-1)$.

Since the total number of steps is proportional to the number of loop iterations, we can conclude that the asymptotic running time of this method is $O(min(n, index - 1))$, where $n$ is the size of `self`.
But because Big-Oh notation is to simplify our running-time expressions by dropping smaller terms, we can drop the "-1" and simply write that the Big-Oh running time is $O(min(n, index))$.


### Special cases

The Big-Oh expression $O(min(n, index))$ for `LinkedList.insert` is the most general expression we could give, since we didn't make any assumptions about the relationship between the length of the linked list and `index`.[^3]

But now suppose we assume that `index <= n`, which is plausible since any larger value would raise an `IndexError` error.
In this case, the Big-Oh expression simplifies to just $O(index)$, revealing that under this assumption, the running time depends only on `index` and not on the length of the linked list at all.

This is a bit subtle, so let's say this again.
We have a relationship between the running time of `insert` and the sizes of two of its inputs. But we can simplify this expression by talking about the relationship between these two input sizes.
Essentially, we say that *if* we treat `index` as small with respect to the size of the list, then the running time of the algorithm does not depend on the size of the list.[^4]

On the other hand, suppose `index` is greater than the size of the list; in this case, the Big-Oh expression simplifies to $O(n)$: even though we know this value raises an `IndexError`, our current implementation requires traversing the entire linked list before realizing that `index` is out of bounds![^5]

[^1]: You might note that mathematically, $n - i = 0$ if $i = n$.
    However, *every* operation takes at least one step to run, and so there's an implicit "max(1, ___)" whenever we write a Big-Oh expression to capture the fact that the running time can't drop below 1.
[^2]: Note that the body of the loop, which again consists of assignment statements, takes constant time.
[^3]: Although we *are* assuming that `index >= 0` here!
[^4]: The most extreme case of this is when `index == 0`, so we're inserting into the front of the linked list.
    As we discussed earlier, this takes *constant time*, meaning it does not depend on the length of the list.
[^5]: Can you find a way to fix this problem *efficiently*?