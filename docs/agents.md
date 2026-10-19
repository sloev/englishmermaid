# Plainpath: a guide for AI agents

Plainpath turns a short plain-English script into a Mermaid diagram of a
website or app: its screens, what each screen shows, the choices it makes and
how people move between screens. Use it when someone asks you to sketch a user
flow, a storyboard, a sitemap, a page layout or the interactions of a UI.

App: https://sloev.github.io/englishmermaid/

## How to hand a diagram to a person

1. Write a script in the syntax below.
2. URL-encode it (`encodeURIComponent` in JavaScript, `urllib.parse.quote` in Python).
3. Give the person this link:

   ```
   https://sloev.github.io/englishmermaid/#text=<url-encoded script>
   ```

   Add `&view=flow` for the screen-to-screen flow view. The default is
   `&view=story`, the storyboard: each screen drawn with its layout.

The person sees the live diagram and can edit the script, save it as a
`.plainpath` file, or export SVG, PNG or Mermaid (`.mmd`). Everything runs in
the browser; nothing is uploaded. The `#` part of a URL never reaches the
server.

If you can only output text, give the script itself in a code block. It reads
fine as plain English, and the person can paste it into the app.

## Syntax

One statement per line. Keywords are case-insensitive. Indent with two spaces
(or a tab) to put lines inside the line above them.

| Statement                                              | Meaning                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Title: Shop`                                          | Diagram title. Optional, once.                                                                                                                                                                                                                                                                                                                            |
| `Screen: Cart`                                         | A page, a step or a state. Also `Page:` and `View:`. Lines indented under it belong to it.                                                                                                                                                                                                                                                                |
| `Popup: Coffee Type`                                   | A modal or dialog that opens on top of a screen. Also `Modal:`, `Dialog:` and `Sheet:`. Drawn dashed.                                                                                                                                                                                                                                                     |
| `Component: Product Card`                              | A reusable part. Any `Show Product Card` links to it.                                                                                                                                                                                                                                                                                                     |
| `Show Header`                                          | A part of the layout. `Show A, B and C` adds several. Indent under a Show to nest parts inside it.                                                                                                                                                                                                                                                        |
| `Text: Free shipping` / `Headline: Pick a blend`       | Words on the screen. `Show "Free shipping"` works too.                                                                                                                                                                                                                                                                                                    |
| `Image: hero photo of the beans`                       | A picture placeholder, drawn as a picture frame in the storyboard. Also `Photo:`, `Picture:`, `Illustration:`, `Logo:`, `Avatar:`, `Banner:`, or `Photo of …`. `Video: how to roast` draws a play button. Add `(square)` or `(tall)` at the end for the shape. A `Show` part named like a picture (`Show Hero Image`, `Show Logo`) is drawn the same way. |
| `Button Checkout goes to Cart`                         | A button and where it leads. `Button: Cancel` without an action is fine. Also `Link`.                                                                                                                                                                                                                                                                     |
| `Choose roast flow:`                                   | A select. Each line indented under it is one option: `Datakaffe: weigh and analyse first, goes to Datakaffe Roasting`. The text after the colon is a description and is optional, as is the `goes to …`. Any words can be an option label, even keywords.                                                                                                 |
| `For each product in products`                         | A repeated part (a list or grid). Put `Show …` lines indented below, or write `For each product in products show Product Card`.                                                                                                                                                                                                                           |
| `If cart is empty`                                     | A choice. Indent what happens below it, or end the line with `go to X` or `show X`.                                                                                                                                                                                                                                                                       |
| `Else if cart has 10+ items`                           | Another branch. Must come straight after an `If` (or `Else if`) at the same indent.                                                                                                                                                                                                                                                                       |
| `Else`                                                 | The last branch. Also `Otherwise`. Also takes `go to X` or `show X` at the end of the line.                                                                                                                                                                                                                                                               |
| `When they tap Buy go to Cart`                         | An event: a tap, click, submit, timer, a device finishing and so on. Also `On`, `After` and `Once`. Put `If`/`Else`/`Go to` lines indented below it, or end the line with the action.                                                                                                                                                                     |
| `Step: Weigh 200 g of beans`                           | A numbered step inside a screen, drawn as "Step 1 of n". `Step 2: …` also works; numbers are assigned in order. Move between steps with `go to next step`, `go to previous step` or `go to step 3`.                                                                                                                                                       |
| `Go to Payment`                                        | A link to another screen. Also `Open X`, `Return to X`, `Continue to X`.                                                                                                                                                                                                                                                                                  |
| `Loop bank checks until it answers then go to Receipt` | Wait or repeat until something happens, then move on.                                                                                                                                                                                                                                                                                                     |
| `// comment` or `Note: comment`                        | Ignored.                                                                                                                                                                                                                                                                                                                                                  |

Ways to say "go to" at the end of a line: `go to`, `goes to`, `open`, `opens`,
`advance to`, `move to`, `continue to`, `return to`, and the passive forms
`you are taken to`, `is sent to` and `are advanced to`. Leading "you", "they",
"the user" or "then" before those words are dropped, so
`When the scan is done you are advanced to the next step` works.

Rules that matter:

- Screen and component names are matched case-insensitively. Each must be
  defined only once.
- `Go to X` where `X` is never defined as a `Screen:` is allowed. X is drawn as a
  dashed "not written yet" screen, which is a good way to mark future work.
- The last `go to` or `show` on an `If`, `Else if`, `Else`, `For each` or `On`
  line is the action; everything before it is the condition or event. Avoid the
  words "go to" and "show" inside conditions.
- Leading `- `, `* ` or `1. ` bullets are ignored, so Markdown-style lists work.
- The first `Screen:` is drawn as the start screen.
- Write lines from the screen's point of view, not as a story about the user:
  `When they tap Buy go to Cart`, not `User taps Buy and goes to Cart`.

## Example: a guided task with a popup and steps

Here is how to turn a narrative like "the user picks a blend, taps +, a modal
asks which kind of roast flow, then a roasting view walks through steps that
advance when a USB analyser finishes" into a script:

```
Title: Datakaffe roast
Screen: Library
  Text: rooost.party
  For each blend in my library
    Show Blend Card
  On tap + on Ethiopian Sunset open Coffee Type

Component: Blend Card
  Show Name, + Button

Popup: Coffee Type
  Headline: Which kind of roast?
  Choose roast flow:
    Datakaffe: weigh and analyse the beans first, goes to Datakaffe Roasting
    Almindelig kaffe: the classic roast, goes to Regular Roasting
  Button Cancel goes to Library

Screen: Datakaffe Roasting
  Step: Measure 200 g of beans X into the analysis bowl
    When the USB analyser has made the analysis go to next step
  Step: Measure 200 g of beans Y into the analysis bowl
    When the USB analyser has made the analysis go to next step
  Step: Put both bowls into the roaster
```

## Example: a shop

```
Title: Shop
Screen: Products
  Show Header
    Show Logo, Search, Cart Icon
  For each product in products
    Show Product Card
  If cart is empty
    Show Empty Hint
  Else if cart has 10+ items
    Show Bulk Discount Banner
  Else
    Show Checkout Button
  On tap Cart Icon go to Cart
  On submit search go to Results

Component: Product Card
  Show Image, Title, Price
  On tap Add go to Cart

Screen: Cart
  For each item in cart show Cart Row
  On tap Checkout
    If signed in go to Payment
    Else go to Sign In

Screen: Payment
  Loop bank checks the card until it answers then go to Receipt
  If card is declined go to Payment
```

Link for this example (flow view): build it with
`"https://sloev.github.io/englishmermaid/#text=" + encodeURIComponent(script) + "&view=flow"`.

## Tips for good diagrams

- Use the words the product team uses for screen and part names, in Title Case.
- Keep conditions and events short: `signed in`, `tap Buy`, `form is valid`.
- Use the storyboard for layout questions ("what is on this page?") and the flow
  view for navigation questions ("how do people get to checkout?").
- Put a part that appears on several screens in a `Component:` and `Show` it on
  each screen.
