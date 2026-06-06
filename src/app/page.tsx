import Image from "next/image";
import { Chat } from "@/components/chat/Chat";

export default function Home() {
  return (
    <main className="mx-auto flex h-screen max-w-3xl flex-col">
      <header className="flex items-center gap-4 border-b border-tii-navy/10 bg-tii-navy px-6 py-4 text-white">
        <Image
          src="/brand/tii-logo-reversed.png"
          alt="Travel Insured International"
          width={120}
          height={98}
          priority
          className="h-12 w-auto"
        />
        <div className="border-l border-white/20 pl-4">
          <h1 className="text-lg font-semibold">Servicing Assistant</h1>
          <p className="text-sm text-white/70">FlexiPAX Plan</p>
        </div>
      </header>
      <div className="flex-1 overflow-hidden">
        <Chat />
      </div>
    </main>
  );
}
