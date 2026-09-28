We’re going to design Blitzcue, an asynchronous letter and category game that you can play with your friends on Discord. The game has the following loop:

1. Each day, a new letter and set of 10 categories or phases are picked. For example, for today the letter could be “P” and we could have categories like “An action video game” or “Something you would find on a desk”. The categories can be from a fixed pool but everyone playing the game should get the same letter and categories. Likely, this means we should use a random seed that is derived from the server timezone, which is EST and locked to that.
2. Users will be given each category one by one and a three minute timer for the whole run. The timer pauses when they leave the Activity and resumes when they return. They can type an answer and hit “Confirm” or “Skip”. They will go through the prompts one by one.
   1. If you skip a prompt, then you will receive it once cycling back through again.
   2. If you confirm a prompt, it should be sent to a backend for verification along with the time it took to get the answer. A classifier model (we can use Jev, but if you want to stub it out with something else for now we can do this later and keep track of it in a TODO) will then decide if the answer is legitimate or not. If it’s not accepted, then we should tell the user and not proceed. If the answer is accepted, we should move on to the next prompt & record the user winning that prompt and the time it took them.
3. They should continue until all prompts are answered and verified or the user has run out of time. The game is then over for the day.The user should **not** be given a score at this time but instead we should should 10 “blocks” (similar to other word game scoring systems) with various hues:
   1. Dark green if the user answered in under 10 seconds
   2. Bright yellow for answers taking 10 to under 20 seconds
   3. Deep orange for accepted answers taking 20 seconds or more
   4. Grey if the user was unable to get a good answer
4. The user should be given a “Share” button they can use to share these color blocks as unicode. Some examples: 🟩🟩🟩🟩🟨🟨🟨🟨
5. There should be a results screen that shows how everyone else in the server did for the day as well.

Some other requirements to keep in mind:

- The game should be registered and embedded as a Discord activity so it can be played daily. This should involve prompts, notifying people of streaks on a daily basis with a prompt to play
- We should have a standalone variant accessible by a query param with mocked out Discord calls so that we can automatically test it
- We should build some sort of end to end test so that we know it works
- I would like to ideally be able to deploy the entire thing to Cloudflare Workers easily, I can create an app if needed

Please ask clarification questions if needed before beginning.
