export enum FrenchLevel {
  A1 = 'A1 (Débutant)',
  A2 = 'A2 (Élémentaire)',
  B1 = 'B1 (Intermédiaire)',
  B2 = 'B2 (Indépendant)',
  C1 = 'C1 (Avancé)',
  C2 = 'C2 (Expert)'
}

export enum ExerciseMode {
  DICTATION = 'Dictée classique',
  CORRECTION = 'Correction de texte'
}

export interface AppConfig {
  level: FrenchLevel;
  theme: string;
  mode: ExerciseMode;
}

export interface Mistake {
  original: string;
  correction: string;
  type: string;
  rule: string;
}

export interface AnalysisResult {
  correctedTextWithMarkup: string; // Text with **markdown** bolding for corrections
  mistakes: Mistake[];
  feedback: string;
}

export interface QuizQuestion {
  id: number;
  question: string; // The sentence with a blank usually
  options: string[];
  correctAnswer: string;
  explanation: string;
}

export interface GeneratedDictation {
  text: string;
  translation: string; // Optional English translation for context
}

export interface SessionRecord {
  id: string;
  date: string;
  config: AppConfig;
  userText: string;
  analysis: AnalysisResult;
  originalDictation?: GeneratedDictation | null;
}