import axios, { AxiosResponse } from "axios";

// Interfaces
interface BaseProviderConfig {
  model: string;
  url?: string;
  apiKey: string;
  function: (prompt: string, config: ProviderConfig) => Promise<string[]>;
}

interface GroqProviderConfig extends BaseProviderConfig {
  sdk: GroqSDK;
}

interface ProviderConfig extends BaseProviderConfig {
  sdk?: GroqSDK;
}

interface GroqSDK {
  new (config: {
    apiKey: string;
    dangerouslyAllowBrowser: boolean;
  }): GroqInstance;
}

interface GroqInstance {
  chat: {
    completions: {
      create: (options: GroqOptions) => Promise<GroqResponse>;
    };
  };
}

interface GroqOptions {
  messages: { role: string; content: string }[];
  model: string;
  temperature: number;
  stream: boolean;
  response_format: { type: string };
  stop: null;
}

interface GroqResponse {
  choices: { message: { content: string } }[];
}

const Groq: GroqSDK = require("groq-sdk");

// Configuration
const config: { [key: string]: ProviderConfig } = {
  groq: {
    model: "llama3-70b-8192",
    sdk: Groq,
    apiKey: "",
    function: groqRequest as any,
  },
  chatgpt: {
    model: "gpt-4-turbo",
    url: "https://api.openai.com/v1/chat/completions", // ✅ correct endpoint
    apiKey: "",
    function: chatgptRequest,
  },
};

// Central request handler
const request = async (
  prompt: string,
  apiKey: string,
  provider: string
): Promise<string[]> => {
  const providerConfig = config[provider];
  if (!providerConfig) {
    throw new Error("Unsupported provider");
  }
  providerConfig.apiKey = apiKey || providerConfig.apiKey;
  return providerConfig.function(prompt, providerConfig);
};

// Groq request
async function groqRequest(
  prompt: string,
  { sdk, apiKey, model }: GroqProviderConfig
): Promise<string[]> {
  if (!sdk) throw new Error("SDK missing for Groq.");

  const groq: GroqInstance = new sdk({
    apiKey: apiKey,
    dangerouslyAllowBrowser: true,
  });

  const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));
  const defaultDelayMs = 5000;

  while (true) {
    try {
      const response: GroqResponse = await groq.chat.completions.create({
        messages: [
          { role: "system", content: "JSON" },
          { role: "user", content: prompt },
        ],
        model: model,
        temperature: 1,
        stream: false,
        response_format: { type: "json_object" },
        stop: null,
      });
      return response.choices.map((c) => c.message.content);
    } catch (error: any) {
      if (error.message?.startsWith("429")) {
        try {
          const jsonStart = error.message.indexOf("{");
          const details = JSON.parse(error.message.substring(jsonStart));
          const msg = details.error.message;
          console.log("Rate limit:", msg);

          const msMatch = msg.match(/Please try again in (\d+(\.\d+)?)ms/);
          const sMatch = msg.match(/Please try again in (\d+(\.\d+)?)s/);
          let retryAfter = defaultDelayMs;

          if (msMatch) retryAfter = parseFloat(msMatch[1]);
          else if (sMatch) retryAfter = parseFloat(sMatch[1]) * 1000;

          console.log(`Retrying in ${retryAfter}ms...`);
          await delay(retryAfter);
        } catch {
          await delay(defaultDelayMs);
        }
      } else {
        console.error("Error from Groq:", error);
        throw error;
      }
    }
  }
}

// ✅ ChatGPT (GPT-4-Turbo) request function
async function chatgptRequest(
  prompt: string,
  config: BaseProviderConfig
): Promise<string[]> {
  const { url, apiKey, model } = config;

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const data = {
    model: model,
    messages: [
      { role: "system", content: "You are a text adventure game engine." },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
  };

  try {
    const response: AxiosResponse = await axios.post(url!, data, { headers });
    return response.data.choices.map((c: any) => c.message.content);
  } catch (error: any) {
    if (error.response?.status === 429) {
      console.log("Rate limit hit. Retrying in 3s...");
      await new Promise((res) => setTimeout(res, 3000));
      return chatgptRequest(prompt, config);
    } else {
      console.error("ChatGPT error:", error);
      throw error;
    }
  }
}

export default request;
