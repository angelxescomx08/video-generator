import { ThemeForm } from "@/components/theme-form";

export default function NewThemePage() {
  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">Nuevo tema</h1>
      <ThemeForm />
    </div>
  );
}
