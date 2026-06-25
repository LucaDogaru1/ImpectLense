# Thoughts

The more I work on `analyze:ticket`, the more I'm convinced this is a complete pain to solve properly.

My first instinct was: *"I'll just improve the matching."* Turns out that's an endless rabbit hole. Add synonyms? Break something else. Add heuristics? Nice, now another ticket gets worse. Every rule fixes one edge case and creates two new ones. It's honestly an infinite problem that neither me nor the AI seems able to solve.

The more I think about it, the more my brain melts. And honestly... who wouldn't?

The real strength of ImpactLens isn't magically guessing the correct entrypoint from a bunch of random business words. LLMs are already pretty good at getting there on their own. The part they *don't* know is everything that happens **after** they find it: who calls this, what depends on it, what breaks if I change it, what else touches it.

That's where `ai-context`, `change-impact`, and `impact` actually shine.

So maybe `analyze:ticket` shouldn't try to be the hero. Maybe it should just be an optional shortcut for tickets that already contain enough technical anchors. Otherwise, let the LLM find the first symbol, then let ImpactLens do what a code graph is actually good at... which is definitely **not** pretending it can solve arbitrary ticket analysis.

And if you can solve this problem without hardcoding half the English language and praying the repo uses the same wording as the ticket... seriously, be my guest. Because I sure as hell can't.

If you read it till here: 
In Austria we say - ge leck heast 
