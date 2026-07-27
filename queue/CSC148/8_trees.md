# 8.1 Introduction to Trees

While the List abstract data type is extremely common and useful, not all data has a natural linear order.
Family trees, corporate organization charts, classification schemes like "Kingdom, Phylum, etc." and even file storage on computers all follow a *hierarchical structure*, in which each entity is linked to multiple entities "below" it.

In computer science, we use a **tree** data structure to represent this type of data. Trees are a *recursive* data structure, with the following definition:
A tree is either[^1]

- empty, or
- has a **root value** connected to any number of other trees, called the **subtrees** of the tree.

We generally draw the root at the top of the tree;
the rest of the tree consists of subtrees that are attached to the root.
Note that a tree can contain a root value but not have any subtrees: this occurs in a tree that contains just a single item.

## Tree Terminology

<img src="tree.svg" alt="Tree diagram" width="50%"></img>

A tree is either **empty** or **non-empty**.
Every non-empty tree has a **root**, which is connected to zero or more **subtrees**.[^2]
The root value of the above tree is labeled A; it is connected to three subtrees.

The **size** of a tree is the number of values in the tree.
*What's the relationship between the size of a tree and the size of its subtrees?*

A **leaf** is a value with no subtrees.
The leaves of the above tree are labeled E, F, G, J, and I.
*What's the relationship between the number of leaves of a tree and the number of leaves of its subtrees?*

The **height** of a tree is the length of the *longest* path from its root to one of its leaves, counting the number of values on the path.
The height of the above tree is 4.
*What's the relationship between the height of a tree and the heights of its subtrees?*

The **children** of a value are all values directly connected underneath that value.
The children of A are B, C, and D.
Note that the number of children of a value is equal to the number of its subtrees, but that these two concepts are quite different.
The **descendants** of a value are its children, the children of its children, etc.
This can be defined recursively as "the descendants of a value are its children, and the descendants of its children."
*What's the relationship between the number of descendants of a value and the number of descendants of its children?*

Similarly, the **parent** of a tree value is the value immediately above and connected to it;
each value in a tree has exactly one parent, except the root, which has no parent.
The **ancestors** of a value are its parent, the parent of its parent, etc.
This too can be defined recursively: "the ancestors of a value are its parent, and the ancestors of its parent."

**Note**: sometimes, it will be convenient to say that descendants/ancestors of a value include the value itself; we'll make it explicit whether to include the node or not when it comes up. Note that a value is **never** a child of itself, nor a parent of itself.

[^1]: Note the similarity between this definition and the one for nested lists.
[^2]: Because subtrees are themselves trees, each one has its own subtrees.
    This sometimes leads to confusion!
    The term "subtree" is always relative to an outer tree, where each subtree is connected to the root of that outer tree.

    # 8.2 A Tree Implementation

Here is a simple implementation of a tree in Python.
As usual, we'll start with a very bare-bones implementation, and then develop more and more methods for this class throughout the course.

```python
class Tree:
    """A recursive tree data structure.

    Private Instance Attributes:
    - _root: The item stored at this tree's root, or None if the tree is empty.
    - _subtrees: The list of all subtrees of this tree.

    Representation Invariants:
    - If self._root is None then self._subtrees is an empty list.
      This setting of attributes represents an empty tree.

      Note: self._subtrees may be empty when self._root is not None.
      This setting of attributes represents a tree consisting of just one
      node.
    """
    _root: Any | None
    _subtrees: list[Tree]

    def __init__(self, root: Any | None, subtrees: list[Tree]) -> None:
        """Initialize a new tree with the given root value and subtrees.

        If <root> is None, this tree is empty.
        Precondition: if <root> is None, then <subtrees> is empty.
        """
        self._root = root
        self._subtrees = subtrees

    def is_empty(self) -> bool:
        """Return whether this tree is empty.

        >>> t1 = Tree(None, [])
        >>> t1.is_empty()
        True
        >>> t2 = Tree(3, [])
        >>> t2.is_empty()
        False
        """
        return self._root is None
```

Our initializer here always creates either an empty tree (when `root is None`), or a tree with a value and the given subtrees.
Note that it is possible for `root` to not be `None`, but `subtrees` to still be empty: this represents a tree with a single root value, and no subtrees.
As we'll soon see, the empty tree and single value cases are generally the base cases when
writing recursive code that operates on trees.


## Recursion on trees

There's a reason we keep asking the same question "What's the relationship between a tree's X and the X of its subtrees?"
Understanding the relationship between a tree and its subtrees---that is, its recursive structure---allows us to write extremely simple and elegant recursive code for processing trees, just as it did with nested lists earlier in the course.

Here's a first example: "the size of a non-empty tree is the sum of the sizes of its subtrees, plus 1 for the root; the size of an empty tree is 0."
This single observation immediately lets us write the following recursive function for computing the size of a tree.[^1]

```python
def __len__(self) -> int:
    """Return the number of items contained in this tree.

    >>> t1 = Tree(None, [])
    >>> len(t1)
    0
    >>> t2 = Tree(3, [Tree(4, []), Tree(1, [])])
    >>> len(t2)
    3
    """
    if self.is_empty():
        return 0
    else:
        size = 1  # count the root
        for subtree in self._subtrees:
            size += subtree.__len__()  # could also do len(subtree) here
        return size
```

Notice that, because we recurse on every subtree and there may be (in fact there very often is)
more than one subtree, this is branching recursion.
Many tree methods use branching recursion.
As you encounter new tree methods, 
pay attention to whether they use branching or linear recursion.

We can generalize this nicely to a template for recursive methods on trees:

```python
def f(self) -> ...:
    if self.is_empty():
        ...
    else:
        ...
        for subtree in self._subtrees:
            ... subtree.f() ...
        ...
```

Of course, often the ellipses will contain some reference to `self._root` as well!


### An explicit size-one case

Often when first dealing with trees, students like to think explicitly about the case where the tree consists of just a single item.
We can modify our `__len__` implementation to handle this case separately by adding an extra check:

```python
def __len__(self):
    if self.is_empty():         # tree is empty
        return 0
    elif self._subtrees == []:  # tree is a single item
        return 1
    else:                       # tree has at least one subtree
        size = 1  # count the root
        for subtree in self._subtrees:
            size += subtree.__len__()
        return size
```

Sometimes, this check will be *necessary*: we'll want to do something different for a tree with a single item than for either an empty tree or one with at least one subtree.
And sometimes, this check will be *redundant*: the action performed by this case is already handled by the recursive step.

In the case of `__len__`, the latter situation applies.
The single-item case is already correctly handled by the recursive step, which will simply return 1 when there are no subtrees, because
the loop does not execute.

However, the possibility of having a redundant case shouldn't discourage you from starting off by including this case.
Treat the detection and coalescing of redundant cases as part of the code editing process.
Your first draft might have some extra code, but that can be removed once you are confident that your implementation is correct.
For your reference, here is the three-case recursive Tree code template:

```python
def f(self) -> ...:
    if self.is_empty():         # tree is empty
        ...
    elif self._subtrees == []:  # tree is a single value
        ...
    else:                       # tree has at least one subtree
        ...
        for subtree in self._subtrees:
            ... subtree.f() ...
        ...
```


## Traversing a tree

Because the elements of a list have a natural order,
lists are pretty straightforward to traverse, meaning (among other things) that it's easy to
write a `__str__` method that will produce a `str` containing all of the elements.
With trees, there is a non-linear ordering on the elements.
How might we write a `__str__` method for trees?

Here's an idea: start with the value of the root,
then recursively add on the `__str__` for each of the subtrees.
That's pretty easy to implement.
The base case is when the tree is empty, and in this case the method returns an empty string.

```python
def __str__(self) -> str:
    """Return a string representation of this tree.
    """
    if self.is_empty():
        return ''
    else:
        # We use newlines (\n) to separate the different values.
        s = f'{self._root}\n'
        for subtree in self._subtrees:
            s += str(subtree)  # equivalent to subtree.__str__()
        return s
```

Consider what happens when we run this on the following tree structure:

```python
>>> t1 = Tree(1, [])
>>> t2 = Tree(2, [])
>>> t3 = Tree(3, [])
>>> t4 = Tree(4, [t1, t2, t3])
>>> t5 = Tree(5, [])
>>> t6 = Tree(6, [t4, t5])
>>> print(t6)
6
4
1
2
3
5
```

We know that 6 is the root of the tree, but it's ambiguous how many children it has.
In other words, while the *items* in the tree are correctly included, we lose the *structure* of the tree itself.

Drawing inspiration from how PyCharm (among many other programs) display the folder structure of our computer's files,
we're going to use indentation to differentiate between the different levels of a tree.
For our example tree,
we want `__str__` to produce this:
```python
>>> # (The same t6 as defined above.)
>>> print(t6)
6
  4
    1
    2
    3
  5
```
In other words, we want `__str__` to return a string that has
0 indents before the root value,
1 indent before its children's values,
2 indents before their children's values,
and so on.
But how do we do this?
We need the recursive calls to act differently---to return strings with more indentation
the deeper down in the tree they are working.
In other words,
we want information from where a method is called to influence what happens inside the method.
This is *exactly* the problem that parameters are meant to solve!

So we'll pass in an extra parameter for the *depth* of the current tree, which will be used
to add a corresponding number of indents before each value in the `str` that is returned.
We can't change the API of the `__str__` method itself,
but we can define a helper method that has this extra parameter:

```python
def _str_indented(self, depth: int) -> str:
    """Return an indented string representation of this tree.

    The indentation level is specified by the <depth> parameter.
    """
    if self.is_empty():
        return ''
    else:
        s = '  ' * depth + str(self._root) + '\n'
        for subtree in self._subtrees:
            # Note that the 'depth' argument to the recursive call is
            # modified.
            s += subtree._str_indented(depth + 1)
        return s
```

Now we can implement `__str__` simply by making a call to `_str_indented`:

```python
def __str__(self) -> str:
    """Return a string representation of this tree.
    """
    return self._str_indented(0)

>>> t1 = Tree(1, [])
>>> t2 = Tree(2, [])
>>> t3 = Tree(3, [])
>>> t4 = Tree(4, [t1, t2, t3])
>>> t5 = Tree(5, [])
>>> t6 = Tree(6, [t4, t5])
6
  4
    1
    2
    3
  5
```


## Technical note: optional parameters

One way to customize the behaviour of functions is to make a parameter **optional** by giving it a **default value**.
This can be done for any function, recursive or non-recursive, inside or outside a class.
The syntax for doing so is quite simple;
we use it in this revised version of `_str_indented`
to give a default value for `depth`:

```python
def _str_indented(self, depth: int=0) -> str:
    """Return an indented string representation of this tree.

    The indentation level is specified by the <depth> parameter.
    """
    if self.is_empty():
        return ''
    else:
        s = '  ' * depth + str(self._root) + '\n'
        for subtree in self._subtrees:
            # Note that the 'depth' argument to the recursive call is
            # modified.
            s += subtree._str_indented(depth + 1)
        return s
```

In this version of `_str_indented`, `depth` is an optional parameter that can either be included or not included when this method is called.

So we can call `t._str_indented(5)`, which sets its `depth` parameter to `5`, as we would expect.
However, we can also call `t._str_indented()` (no argument for `depth` given),
in which case the method is called with the `depth` parameter set to `0`.

Optional parameters are a powerful Python feature that allows us to write more flexible functions and methods to be used in a variety of situations.
Two important points to keep in mind, though:

-   All optional parameters must appear *after* all of the required parameters in the function header.
-   **Do NOT** use mutable values like lists for your optional parameters.
    (If you do, the code will appear to work, until it mysteriously doesn't. Feel free to ask more about this during office hours.)
    Instead, use optional parameters with immutable values like integers, strings, and `None`.


<!-- ## Traversal orders

The `__str__` implementation we gave visits the values in the tree in a fixed order:

1.  *First* it visits the root value.
2.  *Then* it recursively visits each of its subtrees, in left-to-right order. (By convention, we think of the `_subtrees` list as being ordered from left to right.)

This visit order is known as the **(left-to-right) preorder** tree traversal, named for the fact that the root value is visited before any values in the subtrees.
Often when this traversal is described, the "left-to-right" is omitted.

There is another common tree traversal order known as **(left-to-right) postorder**, which---you guessed it---is so named because it visits the root value *after* it has visited every value in its subtrees.
Here is how we might have implemented `_str_indented` in a postorder fashion; note that the only difference is in where the root value is added to the accumulator string `s`.

```python
def _str_indented_postorder(self, depth: int=0) -> str:
    """Return an indented *postorder* string representation of this tree.

    The indentation level is specified by the <depth> parameter.
    """
    if self.is_empty():
        return ''
    else:
        s = ''
        for subtree in self._subtrees:
            # Note that the 'depth' argument to the recursive call is
            # modified.
            s += subtree._str_indented(depth + 1)

        s += '  ' * depth + str(self._root) + '\n'
        return s
``` -->

[^1]: Again, note the similarity to nested lists.
    This will be a consistent refrain throughout this section.

# 8.3 Mutating Trees

Now that we have some experience working with trees, let's talk about mutating them.
There are two fundamental mutating operations that we want to perform on trees:
insertion and deletion.
We'll only cover deletion in this section;
you'll implement an insertion algorithm in this week's lab.

Our goal is to implement the following method:

```python
def delete_item(self, item: Any) -> bool:
    """Delete *one* occurrence of <item> from this tree.

    Return True if <item> was deleted, and False otherwise.
    Do not modify this tree if it does not contain <item>.
    """
```

We'll start by filling in the code template, as usual.
For this case, we'll use the three-branch version, which explicitly separates the size-one case.[^1]

```python
def delete_item(self, item: Any) -> bool:
    """Delete *one* occurrence of <item> from this tree.

    Return True if <item> was deleted, and False otherwise.
    Do not modify this tree if it does not contain <item>.
    """
    if self.is_empty():
        ...
    elif self._subtrees == []:
        ...
    else:
        ...
        for subtree in self._subtrees:
            ... subtree.delete_item(item) ...
        ...
```

The base cases of when this tree is empty and when it has a single value are rather straightforward to implement:

```python
def delete_item(self, item: Any) -> bool:
    if self.is_empty():
        return False              # item is not in the tree
    elif self._subtrees == []:
        if self._root != item:    # item is not in the tree
            return False
        else:                     # resulting tree should be empty
            self._root = None
            return True
    else:
        ...
        for subtree in self._subtrees:
            ... subtree.delete_item(item) ...
        ...
```

In the recursive step, we're going to first check whether the item is equal to the root;
if it is, then we only need to remove the root,
and if not, we need to recurse on the subtrees
to look further for the item.

```python
def delete_item(self, item: Any) -> Bool:
    if self.is_empty():
        return False              # item is not in the tree
    elif self._subtrees == []:
        if self._root != item:    # item is not in the tree
            return False
        else:                     # resulting tree should be empty
            self._root = None
            return True
    else:
        if self._root == item:
            self._delete_root()   # delete the root
            return True
        else:
            for subtree in self._subtrees:
                subtree.delete_item(item)
```

Deleting the root when there are subtrees is a little bit challenging,
so we'll defer that until later.
We can use the common strategy of writing a call to a helper method (`_delete_root`)
that doesn't actually exist yet.
The call will remind us to implement the helper later.

The final `else` branch may look done, but it has serious problems:

1.  It doesn't return anything, violating this method's type contract.
2.  If one of the recursive calls successfully finds and deletes the item,
    no further subtrees should be modified (or even need to be recursed on).

The solution to both of these problems lies in the fact that our current loop doesn't store the value of the recursive calls anywhere.
The key insight is that
we should use the return value of each recursive call
to determine whether an item was deleted,
and whether to continue on to the next subtree:

```python
def delete_item(self, item: Any) -> Bool:
    if self.is_empty():
        return False              # item is not in the tree
    elif self._subtrees == []:
        if self._root != item:    # item is not in the tree
            return False
        else:                     # resulting tree should be empty
            self._root = None
            return True
    else:
        if self._root == item:
            self._delete_root()   # delete the root
            return True
        else:
            for subtree in self._subtrees:
                deleted = subtree.delete_item(item)
                if deleted:
                    # One occurrence of the item was deleted, so we're done.
                    return True
                else:
                    # No item was deleted. Continue onto the next iteration.
                    # Note that this branch is unnecessary; we've only shown it
                    # to write comments.
                    pass

            # If we don't return inside the loop, the item is not deleted from
            # any of the subtrees. In this case, the item does not appear
            # in <self>.
            return False
```

Next, let's deal with the one piece we deferred: implementing `_delete_root`.
Note that all it needs to do is delete the root value of the tree,
and restructure the tree so that the root value
is not `None`.[^2]

There are *many*, *many* ways of doing this.
Here's one where we just pick the rightmost subtree, and "promote" its root and subtrees by moving them up a level in the tree.

```python
def _delete_root(self) -> None:
    """Remove the root item of this tree.

    Precondition: this tree has at least one subtree.
    """
    # Get the last subtree in this tree.
    chosen_subtree = self._subtrees.pop()

    self._root = chosen_subtree._root
    self._subtrees.extend(chosen_subtree._subtrees)
```

This maybe isn't very satisfying, because while the result certainly is still a tree, it feels like we've changed around a lot of the structure of the original tree just to delete a single element.
We encourage you to explore other ways to delete the root of a tree.


## The problem of empty trees

We're not quite done.

In our current implementation of `delete_item`, suppose we delete an item that is a leaf of the given tree.
We'll successfully delete that item, but the result of doing so is an empty tree---so its parent will contain an empty tree in its subtrees list!
For example:

```python
>>> t = Tree(10, [Tree(1, []), Tree(2, []), Tree(3, [])])  # A tree with leaves 1, 2, and 3
>>> t.delete_item(1)
True
>>> t.delete_item(2)
True
>>> t.delete_item(3)
True
>>> t._subtrees
[<__main__.Tree object at 0x081B4770>, <__main__.Tree object at 0x081B49F0>, <__main__.Tree object at 0x0845BB50>]
>>> t._subtrees[0].is_empty() and t._subtrees[1].is_empty() and t._subtrees[2].is_empty()
True
```

Our tree `t` now has three *empty subtrees*!
This is certainly unexpected, and depending on how we've written our `Tree` methods, this may cause errors in our code.
At the very least, these empty subtrees are taking up unnecessary space in our program, and make it slower to iterate through a subtree list.

### Fixing the problem

So instead, if we detect that we deleted a leaf, we should remove the now-empty subtree from its parent's subtree list.
This actually involves only a very small code change in `delete_item`:

```python
def delete_item(self, item: Any) -> Bool:
    if self.is_empty():
        return False              # item is not in the tree
    elif self._subtrees == []:
        if self._root != item:    # item is not in the tree
            return False
        else:                     # resulting tree should be empty
            self._root = None
            return True
    else:
        if self._root == item:
            self._delete_root()   # delete the root
            return True
        else:
            for subtree in self._subtrees:
                deleted = subtree.delete_item(item)
                if deleted and subtree.is_empty():
                    # The item was deleted and the subtree is now empty.
                    # We should remove the subtree from the list of subtrees.
                    # Note that mutating a list while looping through it is
                    # EXTREMELY DANGEROUS!
                    # We are only doing it because we return immediately
                    # afterwards, and so no more loop iterations occur.
                    self._subtrees.remove(subtree)
                    return True
                elif deleted:
                    # The item was deleted, and the subtree is not empty.
                    return True
                else:
                    # No item was deleted. Continue onto the next iteration.
                    # Note that this branch is unnecessary; we've only shown it
                    # to write comments.
                    pass

            # If we don't return inside the loop, the item is not deleted from
            # any of the subtrees. In this case, the item does not appear
            # in <self>.
            return False
```

Note that the code for removing a now-empty subtree
is within a loop that iterates through the list of subtrees.
In general it is **extremely dangerous**
to remove an object from a list as you iterate through it,
because this interferes with the iterations of the loop that is underway.
We avoid this problem because immediately after removing the subtree, we stop the method by returning `True`.


### Implicit assumptions are bad! Representation invariants are good!

Up to this point, you've probably wondered why we need a base case for an empty tree, since it seems like if we begin with a non-empty tree, our recursive calls would never reach an empty tree.
But this is *only* true if we assume that each `_subtrees` list doesn't contain any empty trees!
While this may seem like a reasonable assumption, if we don't make it explicit,
there is no guarantee that this assumption will always hold for our trees.

Even though we recognized and addressed this issue in our implementation of `delete_item`, this is not entirely satisfying---what about other mutating methods?
Rather than having to always remember to worry about removing empty subtrees,
we can make this assumption explicit as a *representation invariant* for our `Tree` class:

```python
class Tree:
    # Private Attributes:
    _root: Any | None
    _subtrees: list[Tree]

    # Representation Invariants:
    # - If self._root is None then self._subtrees is an empty list.
    #   This setting of attributes represents an empty tree.
    #
    #   Note: self._subtrees may be empty when self._root is not None.
    #   This setting of attributes represents a tree consisting of just one value.
    #
    # - (NEW) self._subtrees does not contain any empty trees.
```

With this representation invariant written down, future people working on the `Tree` class won't have to remember a special rule about empty subtrees---instead, they'll just need to remember to consult the class' representation invariants.


## Exercises

1.  Currently, the size-one case in `delete_item` is not redundant;
    however, it is possible to modify `_delete_root` so that this case and the recursive step can be merged, by allowing `_delete_root` to take a non-empty tree that has no subtrees.
    Modify the current implementations of `_delete_root` and `delete_item` to achieve this.
2.  Write a method `delete_item_all` that deletes *every* occurrence of the given item from a tree.
    Think carefully about the order in which you check the root vs. other subtrees here.


[^1]: As we work through the code for each case, draw an example tree
    so that you can trace what happens to it.
[^2]: Why mustn't we leave a `None` behind?
    Hint: Look at the representation invariants for the `Tree` class.

# 8.4 Introduction to Binary Search Trees

Next, we're going to learn about a new data structure called the **Binary Search Tree**
(or BST).
Binary search trees make certain operations fast, and
are the basis of advanced data structures you'll learn about in
[CSC263](https://artsci.calendar.utoronto.ca/course/csc263h1)
that are even more efficient.


## The Multiset ADT

Our goal this week is to take trees and use them to implement the *Multiset ADT*,[^1]
which supports the following behaviours:

- check whether the collection is empty
- check whether a given item is in the collection
- add a given item to the collection
- remove a given item from the collection

Notice that this ADT offers a bit more flexibility than the Container-based ADTs
such as Stack and Queue that
we have seen previously in the course,
as it allows the user to choose which item to remove, rather than using a fixed order of removal.

Because removing an item requires searching the collection to make sure that the item is present, this ADT also supports `__contains__`, which searches within the collection by value, rather than by position.
It is this "search" behaviour that we will consider first.


### Searching in lists

To search a list, the obvious iterative algorithm (for both Python lists and linked lists) is to loop through all items in the list and stop when the item is found.
When the item is not in the list, all items must be checked, making this a * linear time* operation: the time taken for an unsuccessful search grows proportionally with the length of the list.

It turns out that the `Tree.__contains__` method has the same behaviour: if the item is not in the tree, every item in the tree must be checked.[^2]
So just switching from lists to trees isn't enough to do better!

However, one of the great insights in computer science is that adding some additional structure to the input data can enable new, more efficient algorithms.
You have seen a simple form of this called *augmentation* in previous labs,
but we'll look at more complex "structures" imposed on data here.

In the case of Python lists, if we assume that the list is *sorted*, then we can use the **binary search** algorithm to greatly improve the efficiency of search.
If you need a refresher on binary search, please check out the "binary search" videos from this [CSC108 playlist](https://www.youtube.com/watch?v=2QgtAWzBVuk&list=PLfMGJf6SEIv7uysvvsaoknnzfrCCMMk5r).

But because this is still based on built-in array-based lists, we suffer the same drawbacks for insertion and deletion we encountered previously in [Section 4.4](../abstract-data-types/efficiency.md).
So the question is: can we achieve **efficient search, insertion, and deletion** all at once?
*Yes we can!*


## Binary search trees: definitions

To do this, we will combine the branching structure of trees with the idea of binary search to develop a notion of a "sorted tree", which we will call a **Binary Search Tree (BST)**.

A **binary tree** is a tree in which every item has at most two subtrees.
An item in a binary tree satisfies the **binary search tree property** if its value is greater than or equal to all items in its left subtree, and less than or equal to all items in its right subtree.[^3]

A binary tree is a **binary search tree** if *every* item in the tree satisfies the binary search tree property (the "every" is important: in general, it's possible that some items satisfy this property but others don't).

Binary search trees naturally represent *sorted data*.
That is, even if the data doesn't arrive for insertion in sorted order,
the BST keeps track of it in a sorted fashion.
This makes BSTs extremely efficient in doing operations like searching for an item;
but unlike sorted Python lists,
they can be much more efficient at insertion and deletion while maintaining the sortedness of the data!

[^1]: The Multiset ADT is also referred to as the *Collection ADT*.
[^2]: In the code, the recursive case must loop through *every* subtree and make a recursive call.
[^3]: Note that duplicates of the root are allowed in *either* subtree in this version.

# 8.5 Binary Search Tree Implementation and Search

Our implementation of a `BinarySearchTree` class is heavily based on `Tree`,
but with a few important differences.
First, because we know there are only two subtrees, and the left/right ordering matters,
we use explicit attributes to refer to the left and right subtrees:

```python
class BinarySearchTree:
    """Binary Search Tree class.

    This class represents a binary tree satisfying the Binary Search Tree
    property: for every node, its value is >= all items stored in its left
    subtree, and <= all items stored in its right subtree.

    Private Instance Attributes:
    - _root: The item stored at the root of the tree, or None if
             the tree is empty.
    - _left: The left subtree, or None if the tree is empty.
    - _right: The right subtree, or None if the tree is empty.
    """
    _root: Any | None
    _left: BinarySearchTree | None
    _right: BinarySearchTree | None
```

Another difference between `BinarySearchTree` and `Tree` is in
how we distinguish between empty and non-empty trees.
In the `Tree` class, an empty tree has a `_root` value of `None`, and an *empty list* `[]` for its list of subtrees.
In the `BinarySearchTree` class, an empty tree also has a `_root` value of `None`, but its `_left` and `_right` attributes are set to `None` as well.
Moreover, for `BinarySearchTree`, an empty tree is the *only* case where any of the attributes can be `None`; when we represent a non-empty tree, we do so by storing the root item (which isn't `None`) at the root, and storing `BinarySearchTree` objects in the `_left` and `_right` attributes.
The attributes `_left` and `_right` might refer to *empty* binary search trees, but this is different from them being `None`!

Any method we add to the `BinarySearchTree` class (a) can rely upon these properties,
and (b) must maintain these properties, since the other methods rely upon them.
This is so important that we document them in our representation invariants,
along with the BST property itself.

```python
class BinarySearchTree:
    """...

    Representation Invariants:
     - If self._root is None, then so are self._left and self._right.
       This represents an empty BST.
     - If self._root is not None, then self._left and self._right are BinarySearchTrees.
       This represents a non-empty BST.
     - (BST Property) If self is non-empty, all items in self._left are <= self._root,
       and all items in self._right are >= self._root.
    """
```

Here are the initializer and `is_empty` methods for this class, which is based on the corresponding methods for the `Tree` class:

```python
    def __init__(self, root: Any | None) -> None:
        """Initialize a new BST containing only the given root value.

        If <root> is None, initialize an empty BST.
        """
        if root is None:
            self._root = None
            self._left = None
            self._right = None
        else:
            self._root = root
            self._left = BinarySearchTree(None)   # self._left is an empty BST
            self._right = BinarySearchTree(None)  # self._right is an empty BST

    def is_empty(self) -> bool:
        """Return whether this BST is empty.
        """
        return self._root is None
```

Note that we do not allow client code to pass in left and right subtrees as parameters to the initializer.
This is because binary search trees have a much stronger restriction on where values can be located in the tree,
and so a separate method is used to insert new values into the tree that will ensure the BST property is always satisfied.

But before we get to the BST mutating methods (inserting and deleting items), we'll first study the most important BST non-mutating method: searching for an item.


## Searching a binary search tree

Recall that the key insight of the binary search algorithm in a sorted list is that
by comparing the target item with the *middle* of the list, we can immediately cut in half the remaining items to be searched. An analogous idea holds for BSTs.

For general trees, the standard search algorithm is to compare the `item` against the root, and then search in each of the subtrees until either the item is found, or all the subtrees have been searched.
When `item` is not in the tree, every item must be searched.

In stark contrast, for BSTs *the initial comparison to the root tells you which subtree you need to check*.
That is, only one recursive call needs to be made, rather than two!

```python
    def __contains__(self, item: Any) -> bool:
        """Return whether <item> is in this BST.
        """
        if self.is_empty():
            return False
        else:
            if item == self._root:
                return True
            elif item < self._root:
                return item in self._left   # or, self._left.__contains__(item)
            else:
                return item in self._right  # or, self._right.__contains__(item)
```

While this code structure closely matches the empty-check for the general `Tree` class,
we can also combine the two levels of nested ifs to get a slightly more concise version:

```python
    def __contains__(self, item: Any) -> bool:
        """Return whether <item> is in this BST.
        """
        if self.is_empty():
            return False
        elif item == self._root:
            return True
        elif item < self._root:
            return item in self._left   # or, self._left.__contains__(item)
        else:
            return item in self._right  # or, self._right.__contains__(item)
```

Did you notice something different about this method 
in comparison to all the `Tree` methods we've written?
It uses linear, not branching recursion.
Think about why this is possible
and what it means for the efficiency of our code.
Can you imagine any `BinarySearchTree` methods that cannot be written with linear recursion?


# 8.6 Mutating Binary Search Trees

Now that we have seen how searching works on binary search trees, we will study the two mutating methods of the Multiset/Collection ADT: insertion and deletion. Insertion is covered in lab,
so here we'll only discuss deletion.

The basic idea is quite straightforward:
Given an item to delete, we take the same approach as `__contains__` to search for the item.
If we find it, it will be at the root of a subtree (possibly a very small one---even just a leaf), where we delete it:

```python
    def delete(self, item: Any) -> None:
        """Remove *one* occurrence of <item> from this BST.

        Do nothing if <item> is not in the BST.
        """
        if self.is_empty():
            pass
        elif self._root == item:
            self.delete_root()
        elif item < self._root:
            self._left.delete(item)
        else:
            self._right.delete(item)

    def delete_root(self) -> None:
        """Remove the root of this tree.

        Precondition: this tree is *non-empty*.
        """
```

Note that we are again using the strategy of defining a helper method, `delete_root`, to pull out part of the required functionality that's a little tricky.
This keeps our methods from growing too long, and also helps us break down a larger task into smaller steps.

We now need to work on `delete_root`. One thing we might try is to set `self._root = None`. Certainly this would remove the old value of the root,
but this only works if the tree consists of *just* the root (with no children),
so removing it makes the tree empty.
In this case, we need to make sure that we also set `_left` and `_right` to `None` as well, to ensure the representation invariant is satisfied.

```python
    def delete_root(self):
        if self._left.is_empty() and self._right.is_empty():
            self._root = None
            self._left = None
            self._right = None
```

What about the case when the tree has at least one other item?
We can't just set `self._root = None`,
leaving a root value of `None` and yet a child that isn't `None`;
this would violate our representation invariant.
We can think of it as leaving a "hole" in the tree.
We can analyse the tree structure to detect two "easy" special cases:
when at least one of the subtrees is empty, but the other one isn't.
In these cases, we can simply "promote" the other subtree up.

```python
    def delete_root(self) -> None:
        if self._left.is_empty() and self._right.is_empty():
            self._root = None
            self._left = None
            self._right = None
        elif self._left.is_empty():
            # "Promote" the right subtree.
            self._root, self._left, self._right = \
                self._right._root, self._right._left, self._right._right
        elif self._right.is_empty():
            # "Promote" the left subtree.
            self._root, self._left, self._right = \
                self._left._root, self._left._left, self._left._right
```

Finally, we need to handle the case that both subtrees are non-empty.
Rather than restructure the entire tree,
we can fill the "hole" at the root by
*replacing* the root item with another value from the tree
(and then removing that other value from where it was).
The key insight is that there are **only two values** we could replace it with
and still maintain the BST property:
the maximum (or, rightmost) value in the left subtree,
or the minimum (or, leftmost) value in the right subtree.
We'll pick the left subtree here.


```python
    def delete_root(self) -> None:
        if self._left.is_empty() and self._right.is_empty():
            self._root = None
            self._left = None
            self._right = None
        elif self._left.is_empty():
            # "Promote" the right subtree.
            self._root, self._left, self._right = \
                self._right._root, self._right._left, self._right._right
        elif self._right.is_empty():
            # "Promote" the left subtree.
            self._root, self._left, self._right = \
                self._left._root, self._left._left, self._left._right
        else:
            self._root = self._left.extract_max()

    def extract_max(self) -> object:
        """Remove and return the maximum item stored in this tree.

        Precondition: this tree is *non-empty*.
        """
```

We've once again kicked out the hard part to another helper, `extract_max`.
Finding the maximum item is easy: just keep going right to bigger and bigger values
until you can't anymore.
And removing that maximum is much easier than our initial problem of BST deletion
because that maximum has at most one child, on the left.
(How do we know that?)
Here's the method:

```python
    def extract_max(self) -> object:
        """Remove and return the maximum item stored in this tree.

        Precondition: this tree is *non-empty*.
        """
        if self._right.is_empty():
            max_item = self._root
            # Once again, "Promote" the left subtree.
            self._root, self._left, self._right = \
                self._left._root, self._left._left, self._left._right
            return max_item
        else:
            return self._right.extract_max()
```

The single base case here is actually handling two scenarios:
one in which `self` has a left (but no right) child,
and one in which it has *no* children (i.e., it is a leaf).
Confirm for yourself that both of these scenarios are possible,
and that the single base case handles both of them correctly.


## One deletion exercise

Try implementing `delete_all`, which is similar to `delete_item` except that it deletes *all* occurrences of an item from a BST. Think carefully about how to handle duplicate elements!

# 8.7 Tree Traversals

We've seen several methods that travel through, or "traverse" a tree.
Some visit every value in the tree (e.g., `Tree.__str__`), while others don't have to
(e.g., `BinarySearchTree.__contains__`).
Another way in which these methods vary is when they deal with a node vs. when they deal with its subtrees.

## Pre-order and post-order

Consider `Tree.__str__`. The real work happens in its helper method:

```python
def _str_indented(self, depth: int) -> str:
    """Return an indented string representation of this tree.

    The indentation level is specified by the <depth> parameter.
    """
    if self.is_empty():
        return ''
    else:
        s = '  ' * depth + str(self._root) + '\n'
        for subtree in self._subtrees:
            s += subtree._str_indented(depth + 1)
        return s
```
Here, "dealing with" the root means adding its value in to the string that will be returned.
We chose to do this before dealing with its subtrees.
As a result, the root is the very first thing in the resulting string.
Since the method is recursive, the same is true within each
subtree: each root appears before its subtrees, as we saw earlier:

```python
>>> t1 = Tree(1, [])
>>> t2 = Tree(2, [])
>>> t3 = Tree(3, [])
>>> t4 = Tree(4, [t1, t2, t3])
>>> t5 = Tree(5, [])
>>> t6 = Tree(6, [t4, t5])
6
  4
    1
    2
    3
  5
```
This is called a **pre-order traversal** because we deal with the root before (or "pre") its subtrees.

With a simple change to the code,
we can instead add the root's value in to the string *after* adding its subtrees:

```python
def _str_indented(self, depth: int) -> str:
    """Return an indented string representation of this tree.

    The indentation level is specified by the <depth> parameter.
    """
    if self.is_empty():
        return ''
    else:
        s = ''  # We still need to initialize s.
        for subtree in self._subtrees:
            s += subtree._str_indented(depth + 1)
        s = s + '  ' * depth + str(self._root) + '\n'  # Add the root in.
        return s
```

Now the output for that same tree has each root *after* its subtrees:
```python
    1
    2
    3
  4
  5
6
```

This is called a **post-order traversal** because we deal with the root after (or "post") its subtrees.

## Sometimes it matters whether we use pre-order or post-order

In the example above, it didn't matter whether we chose pre-order or post-order traversal
(unless we cared which form the output would take);
either way, the tree is displayed.
But for other methods, we don't have a choice.

Recall `BinarySearchTree.__contains__`:

```python
def __contains__(self, item: Any) -> bool:
    """Return whether <item> is in this BST.
    """
    if self.is_empty():
        return False
    elif item == self._root:
        return True
    elif item < self._root:
        return item in self._left   # or, self._left.__contains__(item)
    else:
        return item in self._right  # or, self._right.__contains__(item)
```

For this method, "dealing with" a node means comparing its root with `item`.
In the code above, we look at the root before recursing on a subtree.
If we didn't do that, we would not know which subtree(s) `item` might occur in, and would be forced
to look in both.
While we could write the method using post-order traversal,
it would be unnecessarily inefficient.
The *only* way to get the benefit of the ordered nature of the BST is to deal with the root before
dealing with its children.
So we use pre-order traversal.

Here's a great example of the opposite situation, where we are forced to use post-order traversal.
We can use a tree to represent an arithmetic expression.
The root is an operator, and its subtrees are the operands.
Here's a simple tree that represents the expression 18 * 4:

<img src="images/expression1-crop.jpg" alt="'A tree with a star at the root (to represent multiplication), and two child nodes: 18 and 4.'"/>

You know, of course, that operands can themselves be expressions.
Our tree representation easily handles this.
Here's a bigger example:

<img src="images/expression2-crop.jpg" alt="'A larger expression tree with a star at the root and two subtrees: one representing the expression (7 - 5) and the other representing the expression (20 / (8 + 2)).'"/>

Do you see how it represents the arithmetic expression $(7 - 5) \times (20 / (8 + 2))$?
Now think about a method whose job is to return the value of the expression represented by a tree.
It couldn't apply the operation stored in the root (multiply, add, or whatever)
until *after* determining the value of each subtree---recursively, of course.
So this method must do a post-order traversal.

You'll see the code for evaluating an expression tree later in this chapter.

## With binary trees, there is another option

So far, we've either dealt with the root before its subtrees or after its subtrees.
With a binary tree, there are only two children (at most).
This opens up the option of dealing with the root *in between* dealing with its left subtree
and dealing with its right subtree.
This is called **in-order traversal**.

Suppose we want to write a BST method that returns a list of the contents of the BST, in non-decreasing order.
Here we do it using an in-order traversal:

```python
def to_sorted_list(self) -> list:
    """Return a list of this BST's items in non-decreasing order.
    """
    if self.is_empty():
        return []
    else:
        # Deal with the root (i.e., add its value to the list we are building) in between
        # dealing with its subtrees.
        return self._left.to_sorted_list() + [self._root] + self._right.to_sorted_list()
```

In the recursive case, if the two recursive calls does what the docstring says,
they will each return a list of items in non-decreasing order.
Further, the BST property says that
the root is
greater than or equal to all items in its left subtree, and
less than or equal to all items in its right subtree.
These facts guarantee that
the list returned is in non-decreasing order
even though we did not sort it!
This example demonstrates:

```python
>>> left = BinarySearchTree(6)
>>> left._left = BinarySearchTree(2)
>>> left._right = BinarySearchTree(8)
>>> left._right._left = BinarySearchTree(7)
>>> right = BinarySearchTree(20)
>>> right._right = BinarySearchTree(30)
>>> bst = BinarySearchTree(10)
>>> bst._left = left
>>> bst._right = right
>>> print(bst.to_sorted_list())
[2, 6, 7, 8, 10, 20, 30]
```

The only way to get the values in sorted order without doing any extra work is to use in-order traversal.
How would we change the method if we wanted the list to be in non-*increasing* order?

Of course, if this method were written for an ordinary binary tree class, then doing an in-order traversal
would guarantee nothing about the order of the output.

## Item order

To check your understanding of the traversal orders, we often ask you to write out the
pre-order, in-order, or post-order traversal of a tree. The easiest way to do this is to think recursively.
And it requires no memorization---other than to remember what "pre" and "post" mean.

Here's a general tree with values in no particular order:

<img src="images/general-tree-crop.jpg" alt="'A general tree with height 5 and internal nodes that have from 1 to 3 children.'"/>

If we are writing its post-order traversal, we know the root has to come last and its subtrees come beforehand.
So we can write that much down, leaving space for each of its three subtrees
(strategically, we have left more space for larger subtrees):

<img src="images/postorder-step1-crop.jpg" alt="'Three arcs where we will write in the post-order traversal of each of the three subtrees of the root, followed by the root value itself.)'"/>

We can easily use the same strategy for the first subtree and the last subtree,
since they are so simple:

<img src="images/postorder-step2-crop.jpg" alt="The first and last subtree arcs have been filled in."/>

The middle subtree is bigger, so it takes a little more work, but the strategy holds.
In the end, we get this:

<img src="images/postorder-end-crop.jpg" alt="Complete post-order traversal of the general tree above."/>


We would do a pre-order traversal with the same strategy, except that the root comes first:

<img src="images/preorder-step1-crop.jpg" alt="'The root value itself followed by three arcs where we will write in the pre-order traversal of each of the three subtrees of the root.)'"/>

In the end, we would have this:

<img src="images/preorder-end-crop.jpg" alt="'Complete post-order traversal of the general tree above.'"/>

Here's a binary tree so we can do an in-order traversal. It's not a BST though---that would be too easy!

<img src="images/binary-tree-crop.jpg" alt="'A binary tree with height 5 and no particular ordering on the values in the nodes.'"/>

We use the same strategy, except of course the root is in between its children.

<img src="images/inorder-step1-crop.jpg" alt="'The root value in between two arcs: one where we will write the in-order traversal of its left subtree, and one where we wlll write the in-order traversal of its right subtree.)'"/>

Try completing this traversal yourself.
This is the final answer:

<img src="images/inorder-end-crop.jpg" alt="'Complete in-order traversal of the binary tree above.'"/>




<!-- ## Traversal orders

The `__str__` implementation we gave visits the values in the tree in a fixed order:

1.  *First* it visits the root value.
2.  *Then* it recursively visits each of its subtrees, in left-to-right order. (By convention, we think of the `_subtrees` list as being ordered from left to right.)

This visit order is known as the **(left-to-right) preorder** tree traversal, named for the fact that the root value is visited before any values in the subtrees.
Often when this traversal is described, the "left-to-right" is omitted.

There is another common tree traversal order known as **(left-to-right) postorder**, which---you guessed it---is so named because it visits the root value *after* it has visited every value in its subtrees.
Here is how we might have implemented `_str_indented` in a postorder fashion; note that the only difference is in where the root value is added to the accumulator string `s`.

```python
def _str_indented_postorder(self, depth: int=0) -> str:
    """Return an indented *postorder* string representation of this tree.

    The indentation level is specified by the <depth> parameter.
    """
    if self.is_empty():
        return ''
    else:
        s = ''
        for subtree in self._subtrees:
            # Note that the 'depth' argument to the recursive call is
            # modified.
            s += subtree._str_indented(depth + 1)

        s += '  ' * depth + str(self._root) + '\n'
        return s
``` -->

# 8.8 Binary Search Trees and Running Time

Now we return to the reason we started talking about binary search trees in the first place: we wanted a more efficient implementation of the Collection ADT, which supports search, insertion, and deletion.

The implementation of `__contains__`, `insert`, and `delete` for BSTs all have the same structure, in that they all make just one recursive call inside the recursive step (they each use the BST property to decide which subtree to recurse into). Let's focus on `__contains__` here.

```python
    def __contains__(self, item: Any) -> bool:
        """Return whether <item> is in this BST.
        """
        if self.is_empty():
            return False
        else:
            if item == self._root:
                return True
            elif item < self._root:
                return item in self._left   # or, self._left.__contains__(item)
            else:
                return item in self._right  # or, self._right.__contains__(item)
```

Each recursive call that is made goes down one level into the tree, so the maximum number of recursive calls that can be made when we perform a search in a tree is equal to the height of the tree plus 1, where the extra call comes because our implementation also recurses into the empty subtree of a leaf.

Since each line of code inside `__contains__` *except* the recursive call runs in constant time (i.e., doesn't depend on the size of the tree), the total running time is proportional to the number of recursive calls made.

Because we argued that the maximum number of recursive calls is roughly the height of the tree, we could say that the running time is **O(h)**, where h is the height of the tree. However, this is only partially correct. In fact, if we "get lucky" and search for the root item of the tree, it doesn't matter how tall it is: we'll only ever make one comparison before returning `True`!


## Worst-case vs. best-case running time

So far in this course, we have mainly focused on how the running time of a function or method depends on the *size* of its inputs. However, it is very often the case that even for a fixed input size, the running time varies depending on some other properties of the inputs---searching for the root item of a BST vs. searching for an item that is very deep in a BST, for example.
It is incorrect to say that the time taken to search for an item of a BST is *always* equal to $h+1$ (where $h$ is the height of the tree);
really, this quantity $h+1$ is just the maximum of a set of possible running times.

We define the **worst-case running time** of an algorithm as a function WC(n), which maps an input size n to the *maximum* possible running time for all inputs of size n.
What we colloquially refer to as the "worst case" for an algorithm is actually a **family of inputs**, one per input size, where each input is one that results in the maximum running time for its size.

For example, we could say that the "worst case" for BST `__contains__` is when "the item we're searching for causes us to recurse down to the deepest leaf in the tree, and then search one of its empty subtrees."
This is a description of not just one input of a fixed size, but rather a set of inputs that all have a property in common.

Since the worst-case running time is a function, we can describe it using our Big-Oh notation. We can say that for BST search, the *worst-case* running time is O(h), where h is the height of the tree.

Similarly, the **best-case running time** is a function that maps input size to the *minimum* possible running time for that input size. We can say that the "best case" for BST search is when we search for the root item in the BST; note again that we are not limiting this description to one input size.
Since `__contains__` returns immediately
if it verifies that the root is equal to the item we're searching for,
we can say that the best-case running time of the method is O(1),
i.e., independent of the height of the tree.

When defining a worst case or best case situation for an algorithm, *don't make any assumptions about the size of the input*!
Students often say that "the best case is when the BST is empty"; but this is incorrect, since it only considers one input size (0).
Whatever description or properties you give for the "worst case" or "best case" should make sense for any input size.


## Tree height and size

You might look at O(h) and recall that we said searching through an unsorted list takes O(n) time, where n is the size of the list. Since both of these expressions look linear, it might seem that BSTs are no better (in terms of Big-Oh) than unsorted lists.

This is where our choice of variables really matters. We can say that BST search is, in the worst-case, proportional to the height of the BST; but remember that the height of a BST can be much smaller than its size!

In fact, if we consider a BST with n items, its height can be as large as n (in this case, the BST just looks like a list). However, it can be as small as log(n)! Why? Put another way, a tree of height h can have at most 2^h - 1 items (draw some examples to convince yourself of this), so if we have n items to store, we need at least log(n) height to store all of them.

So if we can guarantee that BSTs always have height roughly log(n), then in fact all three Collection operations (search, insert, delete) have a worst-case running time of O(h) = O(log n), where h is the height of the BST and n is its size.

Even for sorted lists, for which we can use binary search and find items in O(log n) time in the worst case, they are still limited by insertion and deletion at the front, as we discussed earlier in the course. BSTs aren't---what matters is not *where* the item needs to be inserted, but rather the overall height.

Unfortunately, neither the insertion nor deletion algorithms we have covered in this course will guarantee that when we modify the tree, its height remains roughly logarithmic in its size. (One example you explored in the lab is when you insert items into a BST in sorted order.) However, in the later course CSC263, *Data Structures and Analysis*, you will explore more sophisticated insertion and deletion algorithms that *do* ensure that the height is always logarithmic, thus guaranteeing the efficiency of these operations!

# 8.9 Expression Trees

To wrap up our study of tree-based data structures in this course, we're going to look at one particularly rich application of trees: *representing programs*.
Picture a typical Python program you've written: a few classes, more than a few functions, and dozens or even hundreds of lines of code.
As humans, we read and write code as *text*, and we take for granted the fact that we can ask the computer to run our code to accomplish pretty amazing things.

But what actually happens when we "run" a program?
Another program, called the *Python interpreter*, is responsible for taking our file and running it.
But as you've experienced first-hand by now, writing programs that work directly with text is *hard*; reading strings of characters and extracting meaning from them requires a lot of fussing with small details.
There's a deeper problem with working directly with text:
strings are fundamentally a *linear* structure,
but programs (in Python and other programming languages) are much more complex, and in fact have a naturally *recursive* structure.
For example, we can nest `for` loops and `if` statements within each other as many times as we want, in any order that we want.

So the first step that the Python interpreter takes when given a file to run is to *parse* the text from the file, and create a new representation of the program, called an *Abstract Syntax Tree (AST)*.[^1]
The "Tree" part is significant: given the recursive nature of Python programs, it is natural that we'll use a tree-based data structure to represent them!

This week, we're going to explore the basics of modeling programs using tree-based data structures.
Of course, we aren't going to be able to model all of the Python language in such a short period of time, and so we'll focus on a relatively straightforward part of the language: some simple *expressions* to be evaluated.

## The `Expr` class

In Python, an *expression* is a piece of code which is meant to be evaluated, returning the value of that expression.[^2]

Expressions are the basic building blocks of the language, and are necessary for computing anything.
But because of the immense variety of expression types in Python,
we cannot use just one single class to represent all types of expressions.
Instead, we'll use different classes to represent each kind of expression---but use inheritance to ensure that they all follows the same fundamental interface.
This will set our implementation of "expression trees" apart from other kinds of tree representations we have seen in the course so far.

To begin, here is an abstract class.

```python
class Expr:
    """An abstract class representing a Python expression.
    """
    def evaluate(self) -> Any:
        """Return the *value* of this expression.

        The returned value should be the result of how this expression would be
        evaluated by the Python interpreter.
        """
        raise NotImplementedError
```

Notice that we haven't specified any attributes for this class!
Every type of expression will use a different set of attributes to represent the expression.
Let's make this concrete by looking at two expression types.


## `Num`: numeric constants

The simplest type of Python expression is a *literal constant* like `3` or `'hello'`.
We'll start just by representing numeric constants (`int`s and `float`s).
As you might expect, this is a pretty simple class, with just a single attribute representing the value of the constant.

```python
class Num(Expr):
    """An numeric constant literal.

    Attributes:
        n: the value of the constant
    """
    n: int | float

    def __init__(self, number: int | float) -> None:
        """Initialize a new numeric constant."""
        self.n = number

    def evaluate(self) -> Any:
        """Return the *value* of this expression.

        The returned value should be the result of how this expression would be
        evaluated by the Python interpreter.

        >>> number = Num(10.5)
        >>> number.evaluate()
        10.5
        """
        return self.n  # Simply return the value itself!
```

You can think of constants as being the base cases, or leaves, of an abstract syntax tree.
Next, we'll look at one way of combining these constants together in larger expressions.


## `BinOp`: arithmetic operations

The obvious way to combine numbers together is through the standard arithmetic operations.
In Python, an *arithmetic operation* is an expression that consists of three parts: a left and right subexpression (the two *operands* of the expression), and the operator itself.
We'll represent this with the following class:[^3]

```python
class BinOp(Expr):
    """An arithmetic binary operation.

    Attributes:
        left: the left operand
        op: the name of the operator
        right: the right operand

    Representation Invariants:
        - self.op == '+' or self.op == '*'
    """
    left: Expr
    op: str
    right: Expr

    def __init__(self, left: Expr, op: str, right: Expr) -> None:
        """Initialize a new binary operation expression.

        Precondition: <op> is the string '+' or '*'.
        """
        self.left = left
        self.op = op
        self.right = right
```

Note that the `BinOp` class is basically a binary tree!
Its "root" value is the operator name (stored in the attribute `op`),
while its left and right "subtrees" represent the two *operand subexpressions*.

For example, we could represent the simple arithmetic expression `3 + 5.5`
in the following way:

```python
BinOp(Num(3), '+', Num(5.5))
```

But of course, the types of the `left` and `right` attributes aren't `Num`, they're `Expr`---so either of these can be `BinOp`s as well:

```python
# ((3 + 5.5) * (0.5 + (15.2 * -13.3)))
BinOp(
    BinOp(Num(3), '+', Num(5.5)),
    '*',
    BinOp(
        Num(0.5),
        '+',
        BinOp(Num(15.2), '*', Num(-13.3)))
```

Now, it might seem like this representation is more complicated, and certainly more verbose.
But we must be aware of our own human biases: because we're used to reading expressions like `((3 + 5.5) * (0.5 + (15.2 * -13.3)))`, we take it for granted that we can quickly *parse* this text in our heads to understand its meaning.

A computer program like the Python interpreter, on the other hand, can't do anything "in its head": a programmer needs to have written code for every action it can take!
And this is where the tree-like structure of `BinOp` really shines.
To *evaluate* a binary operation, we first evaluate its left and right operands, and then combine them using the specified arithmetic operator.
The code is among the simplest we've ever written!

```python
class BinOp(Expr):
    def evaluate(self) -> Any:
        """Return the *value* of this expression.
        """
        left_val = self.left.evaluate()
        right_val = self.right.evaluate()

        if self.op == '+':
            return left_val + right_val
        elif self.op == '*':
            return left_val * right_val
        else:
            raise ValueError(f'Invalid operator {self.op}')
```

### The subtle recursive structure of expression trees

Even though the code for `BinOp.evaluate` looks simple, it actually uses recursion in a pretty subtle way.
Notice that we're making pretty normal-looking recursive calls `self.left.evaluate()` and `self.right.evaluate()`, matching the tree structure of `BinOp`.
But... *where's the base case?*

This is probably the most significant difference between our expression tree representation and the tree-based classes we've studied so far in this course.
Because we are using multiple subclasses of `Expr`, there are *multiple* `evaluate` methods, one in each subclass.
Each time `self.left.evaluate` and `self.right.evaluate` are called, they could either refer to `BinOp.evaluate` *or* `Num.evaluate`, depending on the types of `self.left` and `self.right`.

In particular, notice that `Num.evaluate` does *not* make any subsequent calls to `evaluate`, since it just returns the object's `n` attribute.
This is the true "base case" of `evaluate`, and it happens to be located in a completely different method than `BinOp.evaluate`!
So fundamentally, `evaluate` is still an example of structural recursion, just one that spans multiple `Expr` subclasses.


## Looking ahead

Of course, Python programs consist of much, much more than simple arithmetic expressions!
In this course, we're really only scratching the surface of the full set of classes we would need to completely represent any valid Python code.
But even though a complete understanding is beyond the scope of this course,
the work that we're doing here is *not* merely theoretical, but is actually a concrete part of the Python language itself, and tools which operate on Python programs.

It turns out that there is a built-in Python library called `ast` (short for "abstract syntax tree") that uses the exact same approach we've covered here, but of course is comprehensive enough to cover the entire spectrum of the Python language.
If you're interested in reading more about this, feel free to check out some excellent documentation at <https://greentreesnakes.readthedocs.io>.


[^1]: This is, in fact, a simplification: given the complex nature of parsing and Python programs, there is usually more than one kind of tree that is created during the execution of the program, representing different "phases" of the process.
[^2]: You'll learn about this more in a course on programming languages or compilers.
    This is in contrast with *statements*, which represent some kind of action like variable assignment or `return`, and with *definitions*, using keywords like `def` and `class`.
[^3]: For simplicity, we restrict the possible operations to only `+` and `*` for this example.