"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function DeleteVideoButton({ videoId }: { videoId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function onDelete() {
    if (!confirm("Eliminar este video? Se borraran sus versiones, publicaciones y el archivo renderizado. Esta accion no se puede deshacer.")) {
      return;
    }
    setDeleting(true);
    try {
      const response = await fetch(`/api/videos/${videoId}`, { method: "DELETE" });
      if (response.ok) {
        router.push("/");
        router.refresh();
      } else {
        setDeleting(false);
      }
    } catch {
      setDeleting(false);
    }
  }

  return (
    <Button variant="destructive" size="sm" disabled={deleting} onClick={onDelete}>
      {deleting ? "Eliminando..." : "Eliminar video"}
    </Button>
  );
}
