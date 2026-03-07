import { Loader2 } from "lucide-react";

export default function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50">
      <Loader2 className="w-10 h-10 text-emerald-600 animate-spin" />
    </div>
  );
}
