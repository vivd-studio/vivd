import OpenAI from "openai";
import { OPENROUTER_API_KEY } from "./config";

export const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://github.com/vivd",
    "X-Title": "Vivd",
  },
});
