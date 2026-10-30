import { HeroActions, PublicToolList } from "@/components/PublicHome";
import { Logo } from "@/components/Logo";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <Logo />
        <HeroActions compact />
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6">
        <section className="py-16 sm:py-24">
          <p className="text-sm font-medium uppercase tracking-wider text-emerald-700">
            Neighborhood tool lending
          </p>
          <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Borrow what you need. Lend what you don&apos;t.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-stone-600">
            Most tools sit in a garage for most of the year. LendLoop lets the people on your
            street share them instead.
          </p>
          <div className="mt-8">
            <HeroActions />
          </div>
        </section>

        <section className="pb-16">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Available right now</h2>
            <p className="text-sm text-stone-500">Sign in to see details and request a tool.</p>
          </div>
          <PublicToolList />
        </section>

        <section className="grid gap-4 border-t border-stone-200 py-12 sm:grid-cols-3">
          {[
            ["List", "Add a tool you are happy to lend, with its condition and a short note."],
            ["Request", "Pick the dates you need. The lender approves or declines."],
            ["Return", "Bring it back on time. LendLoop sends the reminders, not you."],
          ].map(([title, text], i) => (
            <div key={title}>
              <p className="text-sm font-semibold text-emerald-700">
                {i + 1}. {title}
              </p>
              <p className="mt-1 text-sm text-stone-600">{text}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-stone-200 py-6 text-center text-xs text-stone-400">
        LendLoop is a demo project.
      </footer>
    </div>
  );
}
