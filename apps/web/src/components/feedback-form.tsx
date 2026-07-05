"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function FeedbackForm({ videoId }: { videoId: string }) {
  const [rating, setRating] = useState("5");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const response = await fetch(`/api/videos/${videoId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: Number(rating), comment: comment || undefined }),
      });
      if (response.ok) {
        setDone(true);
        setComment("");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-3">
      <h3 className="font-semibold">Dejar feedback para mejorar futuros videos de este tema</h3>
      <div className="space-y-2">
        <Label htmlFor="rating">Calificacion</Label>
        <Select id="rating" value={rating} onChange={(e) => setRating(e.target.value)}>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="comment">Comentario</Label>
        <Textarea
          id="comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Que funciono o que se deberia corregir en el proximo video de este tema?"
        />
      </div>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Enviando..." : "Enviar feedback"}
      </Button>
      {done && <p className="text-sm text-muted-foreground">Feedback guardado, se usara en la proxima generacion.</p>}
    </form>
  );
}
