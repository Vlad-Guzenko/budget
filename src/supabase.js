import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.warn(
    "Не заданы VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. " +
    "Добавь их в .env (локально) и в Environment Variables на Vercel."
  );
}

export const supabase = createClient(url ?? "", key ?? "");
