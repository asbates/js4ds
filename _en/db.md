---
permalink: "/en/db/"
title: "Using a Database"
questions:
- "What options do modern applications have for storing data?"
- "Where can I find a quick introduction to relational databases?"
- "How can a JavaScript program get information out of a relational database?"
- "How is the data returned by the database formatted?"
- "How can I make database-backed applications testable?"
keypoints:
- "Relational databases store data in tables made up of fields (columns) and records (rows)."
- "Programs interact with relational databases using SQL queries."
- "Non-relational databases store data as JSON-like data structures."
- "Basic SQL queries select and filter data."
- "JavaScript programs send SQL queries to a database and get the results as a list of lists."
- "Using an in-memory database to make tests faster and ensure that they are isolated."
- "Use callbacks to handle the results of queries."
---

We now know how to [build a server](../server/) to share our data with the world;
the next step is to store the data itself so that it can be served.
There are many more choices for this today than there were ten years ago,
fur [relational databases](../gloss/#relational-database) continue to be the workhorse of the web.

A relational database contains zero or more [tables](../gloss/#table).
Each table has a fixed set of [fields](../gloss/#field),
which are usually drawn as columns,
and zero or more [records](../gloss/#record),
which are usually drawn as rows.
Each record has a value for each field,
which may be a number, a character string, a date and time,
or `null` if the value is missing or unknown.

Relational databases are manipulated using a language called [SQL](../gloss/#sql),
which originally stood for "Structured Query Language"
and is pronounced "sequel" or "ess cue ell" depending on whether the speaker is
left or right handed.
Alternatives are collectively known as [NoSQL databases](../gloss/#nosql-database),
and use many different storage models.
We will use a SQL database because it's still the most common choice,
but we won't try to introduce SQL itself:
see [this short tutorial][sql-tutorial] instead.
As an example problem,
we will store information about workshops.
Here's the start of our database:

```sql
drop table if exists Workshop;

create table Workshop(
	ident		integer unique not null primary key,
	name		text unique not null,
	duration	integer not null -- duration in minutes
);

insert into Workshop values(1, "Building Community", 60);
insert into Workshop values(2, "ENIAC Programming", 150);
```
{: title="src/database/fixture.sql"}

In the rest of this tutorial,
we will build a class to handle our interactions with a SQLite database,
test it,
and then put a web service on top of it.
Managing database interactions with a separate class makes it easier to test,
and also makes it easier to change from one database to another
if we want to down the road.

## Starting Point {#s:database-start}

Our class, imaginatively named `Database`,
tkaes the path to the SQLite database file as a constructor parameter
and creates a [connection manager](../gloss/#connection-manager)
through which we can send queries and get results.
We will create one method for each query we want to run,
and one helper method to display query results.
We will give all of the query methods the same [signature](../gloss/#signature)
so that can be handled interchangeably.
The whole thing looks like this:

```js
const sqlite3 = require("sqlite3")

class Database {

  constructor (path) {
    this.db = new sqlite3.Database(path, sqlite3.OPEN_READWRITE, (err) => {
      if (err) this.fail(`Database open error ${err} for "${path}"`)
    })
  }

  getAll (args) {
    this.db.all(Q_WORKSHOP_GET_ALL, [], (err, rows) => {
      if (err) this.fail(err)
      this.display(rows)
    })
  }

  getOne (args) {
    this.db.all(Q_WORKSHOP_GET_ONE, args, (err, rows) => {
      if (err) this.fail(err)
      this.display(rows)
    })
  }

  display (rows) {
    for (let r of rows) {
      console.log(r)
    }
  }

  fail (msg) {
    console.log(msg)
    process.exit(1)
  }
}
```
{: title="src/database/database-initial.js"}

This makes a lot more sense once we see what the queries look like:

```js
const Q_WORKSHOP_GET_ALL = `
select
  Workshop.ident        as workshopId,
  Workshop.name         as workshopName,
  Workshop.duration     as workshopDuration
from
  Workshop
`

const Q_WORKSHOP_GET_ONE = `
select
  Workshop.ident        as workshopId,
  Workshop.name         as workshopName,
  Workshop.duration     as workshopDuration
from
  Workshop
where
  Workshop.ident = ?
`
```
{: title="src/database/database-initial.js"}

It's easy to overlook,
but the query to get details of one workshop has a question mark `?` as the value of `Workshop.ident`.
This means that the query expects us to provide a parameter when we call it
that will be substituted in for the question mark
to specify which workshop we're interested in.
This is why the arguments passed to `getOne` as `args`
are then passed through to `db.all`;
it's also why `getAll` takes an `args` parameter,
but ignores it and always passed `[]` (no extra values) to `db.all` when running the query.

All right:
what does the [driver](../gloss/#driver) look like?

```js
function main () {
  const path = process.argv[2]
  const action = process.argv[3]
  const args = process.argv.splice(4)
  const database = new Database(path)
  database[action](args)
}

main()
```
{: title="src/database/database-initial.js"}

This is simple enough:
it gets the path to the database file,
the desired action,
and any extra arguments from `process.argv`,
then creates an instance of the `Database` class and---um.
And then it calls `database[action](args)`,
which takes a moment to figure out.
What's going on here is that an instance of a class is just a special kind of object,
and we can always look up an object's fields by name using `object[name]`,
so if the string `action` (taken from the command-line argument) is `getAll` or `getOne`,
then `database[action](args)` is either `database.getAll(args)` or database.getOne(args)`.
This is lever,
but if we ask for an action like `show` or `help` or `GetOne` (with an upper-case 'G'),
then `database[action]` doesn't exist and we get a very confusing error message.
We really should try to do better...

But before then,
let's try running this:

```sh
node database-initial.js fixture.db getAll
```
```text
{ workshopId: 1,
  workshopName: 'Building Community',
  workshopDuration: 60 }
{ workshopId: 2,
  workshopName: 'ENIAC Programming',
  workshopDuration: 150 }
```

That seems to have worked:
`getAll` was called,
and the result is an array of objects,
one per record,
whose names are the derived in an obvious way from the names of the columns.

## In-Memory Database {#s:database-in-memory}

The previous example always manipulates database on disk.
For testing purposes,
it's faster and safer to use an [in-memory database](../gloss/#in-memory-database).
Let's modify the constructor of `Database` to set this up:

```js
  constructor (mode, path) {
    this.path = path
    switch (mode) {
    case 'memory' :
      const setup = fs.readFileSync(this.path, 'utf-8')
      this.db = new sqlite3.Database(':memory:', sqlite3.OPEN_READWRITE, (err) => {
        if (err) this.fail(`IN-MEMORY DATABASE OPEN ERROR "${err}"`)
      })
      this.db.exec(setup, (err) => {
        if (err) this.fail(`UNABLE TO INITIALIZE IN-MEMORY DATABASE FROM "${this.path}"`)
      })
      break

    case 'file' :
      this.db = new sqlite3.Database(this.path, sqlite3.OPEN_READWRITE, (err) => {
        if (err) this.fail(`DATABASE OPEN ERROR ${err} for "${path}"`)
      })
      break

    default :
      this.fail(`UNKNOWN MODE "${mode}"`)
      break
    }
  }
```
{: title="src/database/database-mode.js"}

If the `mode` parameter is the string `"memory"`,
we create an in-memory database and initialize it by executing
a file full of setup commands specified by the user---in our case,
exactly the commands we showed at the start of the lesson.
If the `mode` is `"file"`,
we interpret the file argument as the name of an on-disk database
and proceed as before.
And we put our error messages in ALL CAPS because that's the most annoying option easily available to us.

Less annoyingly,
we can use destructuring to handle command-line arguments in the driver:

```js
function main () {
  const [mode, path, action, ...args] = process.argv.splice(2)
  const database = new Database(mode, path)
  database[action](args)
}
```
{: title="src/database/database-mode.js"}

Here, the expression `...args` means
"take anything left over after the fixed names have been matched and put it in an array called `args`".
With these changes in place,
we can run a query to get details of the second workshop like this:

```sh
node database-mode.js memory fixture.sql getOne 2
```
```text
{ workshopId: 2,
  workshopName: 'ENIAC Programming',
  workshopDuration: 150 }
```

After a bit of experimentation,
we decide to take this even further to make testing easier.
We will allow the driver to read the SQL script itself and pass that into `Database`
so that we can do the file I/O once and then repeatedly build a database in memory for testing.
That way,
each of our tests will start with the database in a known, predictable state,
regardless of what other tests may have run before
and what changes they might have made to the database.
Here are the changes to the constructor:

```js
  constructor (mode, arg) {
    switch (mode) {
      case 'direct' :
        this._inMemory(arg)
        break

      case 'memory' :
        const setup = fs.readFileSync(arg, 'utf-8')
        this._inMemory(setup)
        break

      case 'file' :
        this._inFile(arg)
        break

      default :
        this.fail(`Unknown mode "${mode}"`)
        break
    }
  }
```
{: title="src/database/database-mixed.js"}

And here are the supporting methods:

```js
  _inMemory (script) {
    this.db = new sqlite3.Database(':memory:', sqlite3.OPEN_READWRITE, (err) => {
      if (err) this.fail(`In-memory database open error "${err}"`)
    })
    this.db.exec(script, (err) => {
      if (err) this.fail(`Unable to initialize in-memory database from "${script}"`)
    })
  }

  _inFile (path) {
    this.db = new sqlite3.Database(path, sqlite3.OPEN_READWRITE, (err) => {
      if (err) this.fail(`Database open error "${err}" for "${path}"`)
    })
  }
```
{: title="src/database/database-mixed.js"}

We also need to change the driver
(and check, finally, that the requested action is actually supported):

```js
function main () {
  let [mode, setup, action, ...args] = process.argv.splice(2)
  if (mode === 'direct') {
    setup = fs.readFileSync(setup, 'utf-8')
  }
  const database = new Database(mode, setup)
  if (!(action in database)) {
    database.fail(`No such operation "${action}"`)
  }
  database[action](args)
}
```
{: title="src/database/database-mixed.js"}

## Making It Testable {#s:database-testable}

We put the database class and its driver in separate files
so that applications can load just the former.
We will now change the database query methods to return results for display
rather than displaying them directly,
since we will eventually want to compare them or return them to a server rather than printing them:

```js
class Database {

  ...

  getAll (args) {
    this.db.all(Q_WORKSHOP_GET_ALL, [], (err, rows) => {
      if (err) this.fail(err)
      return rows
    })
  }

  ...
}
```
{: title="src/database/separate-database.js"}

The driver then looks like this:

```js
const Database = require('./separate-database')

const display = (rows) => {
  for (let r of rows) {
    console.log(r)
  }
}

const main = () => {
  let [mode, path, action, ...args] = process.argv.splice(2)
  const db = new Database(mode, path)
  if (!(action in db)) {
    db.fail(`No such operation "${action}"`)
  }
  const result = db[action](args)
  display(result)
}

main()
```
{: title="src/database/separate-driver.js"}

Let's try running it:

```sh
node separate-driver.js file fixture.db getAll
```
```text
  for (let r of rows) {
              ^

TypeError: Cannot read property 'Symbol(Symbol.iterator)' of undefined
    at display (/project/src/database/separate-driver.js:4:15)
    at main (/project/src/database/separate-driver.js:16:3)
```

Whoops: the `run` method of the database delivers results to a callback;
its own result is therefore `undefined`,
so there's nothing in the caller to print.

The solution is to give the `get` methods a callback of their own:

```js
class Database {

  ...

  getAll (callback, args) {
    this.db.all(Q_WORKSHOP_GET_ALL, [], (err, rows) => {
      if (err) this.fail(err)
      callback(rows)
    })
  }

  ...
}
```
{: title="src/database/callback-database.js"}

We then change the driver to pass `display` to the database method it's calling:

```js
const Database = require('./callback-database')

const display = (rows) => {
  for (let r of rows) {
    console.log(r)
  }
}

const main = () => {
  let [mode, path, action, ...args] = process.argv.splice(2)
  const db = new Database(mode, path)
  if (!(action in db)) {
    db.fail(`No such operation "${action}"`)
  }
  db[action](display, args)
}

main()
```
{: title="src/database/callback-driver.js"}

This looks strange the first few (dozen) times,
but it's the way JavaScript works:
instead of asking for something and then operating on it,
we say,
"Here's what we want to do once results are available."

## Testing {#s:database-testing}

Now,
finally,
we can write some tests:

```js
const test = require('tape')
const Database = require('./callback-database')

const FIXTURE = `
drop table if exists Workshop;

create table Workshop(
        ident           integer unique not null primary key,
        name            text unique not null,
        duration        integer not null -- duration in minutes
);

insert into Workshop values(1, "Building Community", 60);
insert into Workshop values(2, "ENIAC Programming", 150);
`

test('Can get all workshops', (t) => {
  expected = [
    { workshopName: 'Building Community', workshopDuration: 60, workshopId: 1 },
    { workshopName: 'ENIAC Programming', workshopDuration: 150, workshopId: 2 }
  ]
  new Database('direct', FIXTURE).getAll([], (results) => {
    t.deepEqual(results, expected, 'Got expected workshops')
    t.end()
  })
})

test('Can get one workshop', (t) => {
  expected = [
    { workshopName: 'Building Community', workshopDuration: 60, workshopId: 1 }
  ]
  new Database('direct', FIXTURE).getOne(1, (results) => {
    t.deepEqual(results, expected, 'Got single expected workshop')
    t.end()
  })
})

test('Can only get workshops that exist', (t) => {
  new Database('direct', FIXTURE).getOne(99, (results) => {
    t.deepEqual(results, [], 'Got no workshops matching nonexistent key')
    t.end()
  })
})
```
{: title="src/database/basic-tests.js"}

Each test has the same structure:
we define the expected result,
create an entirely new database,
and then call the method being tested,
passing it the parameter needed for operation
and the callback that will receives results.
That callback uses the `t` object passed to our function by `test`
to tell us when the test has completed.
Inside the test we use `deepEqual` to check that the data structures are exact matches.

## Exercises {#s:database-exercises}

### Copying Records

Write a program that copies all the rows
from the table `Workshop` in a database `source.db`
to a table with the same name in a new database `backup.db`.

### Filtering Records

Add a new method to the `Database` class
to get all workshops that are longer than a specified time:

```js
const db = new Database(path)
const rows = db.getLongerThan(100)
assert.deepEqual(rows, [
  {workshopName: 'ENIAC Programming', workshopDuration: 150, workshopId: 2}
])
```

Your `Database.getLongerThan` method's SQL query
will need to use a `where` clause
that selects specific records.

### More Filtering

The SQL query encapsulated in the variable below can be used to
find all workshop whose duration falls within a range.

```js
const Q_WORKSHOP_DURATION_RANGE = `
select
  Workshop.ident        as workshopId,
  Workshop.name         as workshopName,
  Workshop.duration     as workshopDuration
from
  Workshop
where
  (Workshop.duration <= ?) and (Workshop.duration >= ?)
`
```

What do the `?`s mean in this query?
Write another method for the `Database` class, `getWithinLengthRange([args])`, that uses this query, taking arguments from the commandline as before.
What happens when you provide the wrong number of arguments to this function? Or
if you provide them in the wrong order?
Can you write a test that provides more useful feedback than this?

### Handling Errors

The `Database` class prints a message and exits when it detects an error.
This is bad practice,
and I should be ashamed of having done it.
The right thing to do is to [throw](../gloss/#throw)
an [exception](../gloss/#exception)
that main program can [catch](../gloss/#catch)
and handle however it wants.

1. Modify the code to do this.
2. Modify the tests to check that the right exceptions are thrown when they should be.

{% include links.md %}