import { GoogleGenAI, Type, Modality } from "@google/genai";
import { AppConfig, AnalysisResult, GeneratedDictation, QuizQuestion, Mistake, FrenchLevel } from "../types";

// Helper to get client safely
const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing. Please check your environment variables.");
  }
  return new GoogleGenAI({ apiKey });
};

export const generateDictationText = async (config: AppConfig): Promise<GeneratedDictation> => {
  const ai = getClient();
  
  const prompt = `Agis comme un professeur de français expert.
  Génère un texte court (5-6 phrases) pour une dictée.
  Niveau: ${config.level}.
  Thème: ${config.theme}.
  Le texte doit être cohérent, grammaticalement correct et adapté au niveau demandé.
  Inclus une traduction en anglais pour le contexte.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING, description: "Le texte de la dictée en français." },
          translation: { type: Type.STRING, description: "Traduction anglaise du texte." }
        },
        required: ["text", "translation"]
      }
    }
  });

  const json = JSON.parse(response.text || "{}");
  return json as GeneratedDictation;
};

export const generateSpeech = async (text: string): Promise<string> => {
  const ai = getClient();
  
  // Using the specialized TTS model
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: {
      parts: [{ text: text }]
    },
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' } // Kore is usually clear and good for dictation
        }
      }
    }
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  
  if (!base64Audio) {
    throw new Error("Failed to generate audio.");
  }

  return base64Audio;
};

export const analyzeText = async (
  userText: string,
  originalText: string | null,
  config: AppConfig
): Promise<AnalysisResult> => {
  const ai = getClient();

  let prompt = "";
  if (config.mode === 'Dictée classique' && originalText) {
    prompt = `Analyse la dictée de l'élève.
    Texte original (correct) : "${originalText}"
    Texte de l'élève : "${userText}"
    
    1. Identifie toutes les erreurs (orthographe, grammaire, ponctuation).
    2. Fournis une version du texte de l'élève où les corrections sont mises en évidence par des astérisques doubles (ex: **correction**). Si un mot est manquant, ajoute-le entre crochets et en gras.
    3. Liste les erreurs dans un tableau structuré avec la règle expliquée simplement.
    4. Donne un feedback général bienveillant.`;
  } else {
    prompt = `Corrige ce texte en français.
    Texte de l'élève : "${userText}"
    Niveau de l'élève : ${config.level}
    
    1. Identifie toutes les erreurs.
    2. Renvoie le texte corrigé complet, en mettant en gras (**mot**) les parties qui ont été changées par rapport à la version de l'élève.
    3. Liste les erreurs dans un tableau structuré.
    4. Donne un feedback général bienveillant.`;
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          correctedTextWithMarkup: { 
            type: Type.STRING, 
            description: "Le texte complet corrigé. Mets les corrections en gras avec la syntaxe Markdown (**mot**)." 
          },
          feedback: { type: Type.STRING, description: "Commentaire encourageant sur la performance." },
          mistakes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                original: { type: Type.STRING, description: "Ce que l'élève a écrit (ou 'manquant')." },
                correction: { type: Type.STRING, description: "La forme correcte." },
                type: { type: Type.STRING, description: "Type d'erreur (ex: Conjugaison, Accord)." },
                rule: { type: Type.STRING, description: "Explication simple de la règle." }
              },
              required: ["original", "correction", "type", "rule"]
            }
          }
        },
        required: ["correctedTextWithMarkup", "feedback", "mistakes"]
      }
    }
  });

  const json = JSON.parse(response.text || "{}");
  return json as AnalysisResult;
};

export const generateExercises = async (mistakes: Mistake[], level: FrenchLevel): Promise<QuizQuestion[]> => {
  const ai = getClient();
  
  // If no mistakes, generate generic advanced exercises
  const mistakesContext = mistakes.length > 0 
    ? `Basé sur ces erreurs commises par l'élève : ${JSON.stringify(mistakes.slice(0, 5))}` 
    : `L'élève n'a fait aucune erreur. Génère des exercices de niveau supérieur (${level}) pour le challenger.`;

  const prompt = `Agis comme un professeur. ${mistakesContext}
  Génère exactement 3 exercices à choix multiples (QCM) pour pratiquer les règles non acquises ou renforcer le niveau.
  Pour chaque exercice :
  - Une phrase à trou.
  - 3 ou 4 options.
  - La bonne réponse.
  - Une explication courte.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          exercises: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.INTEGER },
                question: { type: Type.STRING, description: "La phrase avec un '___' pour le trou." },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                correctAnswer: { type: Type.STRING },
                explanation: { type: Type.STRING }
              },
              required: ["id", "question", "options", "correctAnswer", "explanation"]
            }
          }
        }
      }
    }
  });

  const json = JSON.parse(response.text || "{}");
  return json.exercises || [];
};