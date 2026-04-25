import { MetaverseGame } from "@/components/MetaverseGame";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-900">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <h1 className="text-2xl font-bold">2Dメタバース 最小プロトタイプ</h1>
        <p className="text-sm text-slate-600">
          矢印キーまたはWASDでキャラクターを移動できます。座標は画面下とコンソールへ表示されます。
        </p>
        <MetaverseGame />
      </div>
    </main>
  );
}
