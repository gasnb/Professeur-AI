import React, { useState, useRef, useEffect, useCallback } from 'react';
import { BookOpen, Mic, PenTool, CheckCircle, RotateCcw, Volume2, ArrowRight, Loader2, Play, Pause, AlertCircle, History, ArrowLeft, Calendar, Trash2 } from 'lucide-react';
import { FrenchLevel, ExerciseMode, AppConfig, AnalysisResult, QuizQuestion, GeneratedDictation, SessionRecord } from './types';
import * as GeminiService from './services/geminiService';
import { decodeAudioData } from './utils/audioUtils';
import { StepWizard } from './components/StepWizard';

// --- Components ---

const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' | 'danger' }> = ({ 
  className = '', 
  variant = 'primary', 
  children, 
  ...props 
}) => {
  const baseStyles = "px-6 py-3 rounded-lg font-semibold transition-all duration-200 flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-offset-2";
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-md hover:shadow-lg focus:ring-indigo-500",
    secondary: "bg-teal-500 text-white hover:bg-teal-600 shadow-md hover:shadow-lg focus:ring-teal-500",
    outline: "border-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50 focus:ring-indigo-500",
    danger: "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 focus:ring-red-500"
  };

  return (
    <button className={`${baseStyles} ${variants[variant]} ${className} disabled:opacity-50 disabled:cursor-not-allowed`} {...props}>
      {children}
    </button>
  );
};

const LoadingOverlay: React.FC<{ message: string }> = ({ message }) => (
  <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-4">
    <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
    <p className="text-lg text-indigo-900 font-medium animate-pulse">{message}</p>
  </div>
);

// --- Helpers ---

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatDate = (isoString: string): string => {
  return new Date(isoString).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// --- Main App ---

export default function App() {
  const [step, setStep] = useState<'config' | 'exercise' | 'analysis' | 'reinforcement' | 'history'>('config');
  const [config, setConfig] = useState<AppConfig>({
    level: FrenchLevel.B1,
    theme: 'Culture Française',
    mode: ExerciseMode.DICTATION
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data States
  const [dictationData, setDictationData] = useState<GeneratedDictation | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [userText, setUserText] = useState('');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [exercises, setExercises] = useState<QuizQuestion[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, string | null>>({});

  // History State
  const [history, setHistory] = useState<SessionRecord[]>([]);
  const [isReviewingHistory, setIsReviewingHistory] = useState(false);

  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  // Load history from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('french_tutor_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  // Save history to localStorage
  useEffect(() => {
    localStorage.setItem('french_tutor_history', JSON.stringify(history));
  }, [history]);

  // Initialize Audio Context on user interaction (to adhere to browser policies)
  const initAudio = () => {
    if (!audioContext) {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      setAudioContext(ctx);
      return ctx;
    }
    return audioContext;
  };

  const stopAudio = () => {
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch (e) {
        // Ignore errors if already stopped
      }
      audioSourceRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const togglePlayAudio = async () => {
    if (!audioContext || !audioBuffer) return;

    if (isPlaying) {
      stopAudio();
    } else {
      // Resume context if suspended
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // Stop any previous instance just in case
      stopAudio();

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      
      source.onended = () => {
        stopAudio();
      };

      // Start playback
      const startTime = audioContext.currentTime;
      startTimeRef.current = startTime;
      source.start(0);
      audioSourceRef.current = source;
      setIsPlaying(true);
      setCurrentTime(0);

      // Start animation loop for progress bar
      const animate = () => {
        if (!audioContext) return;
        const now = audioContext.currentTime;
        const elapsed = now - startTimeRef.current;
        
        if (elapsed < audioBuffer.duration) {
          setCurrentTime(elapsed);
          rafRef.current = requestAnimationFrame(animate);
        } else {
          setCurrentTime(audioBuffer.duration);
        }
      };
      
      rafRef.current = requestAnimationFrame(animate);
    }
  };

  const handleSubmitText = async () => {
    if (!userText.trim()) return;
    setLoading(true);
    setError(null);
    stopAudio(); // Stop audio if playing
    
    try {
      const original = config.mode === ExerciseMode.DICTATION ? dictationData?.text || null : null;
      const result = await GeminiService.analyzeText(userText, original, config);
      setAnalysis(result);

      // Save to history
      const newRecord: SessionRecord = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        config: { ...config },
        userText: userText,
        analysis: result,
        originalDictation: dictationData
      };
      setHistory(prev => [newRecord, ...prev]);

      setStep('analysis');
    } catch (err: any) {
      setError("Erreur lors de l'analyse : " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartExercises = async () => {
    setLoading(true);
    setError(null);
    try {
      const questions = await GeminiService.generateExercises(analysis?.mistakes || [], config.level);
      setExercises(questions);
      setStep('reinforcement');
    } catch (err: any) {
      setError("Impossible de générer les exercices : " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    stopAudio();
    setStep('config');
    setUserText('');
    setDictationData(null);
    setAnalysis(null);
    setExercises([]);
    setQuizAnswers({});
    setError(null);
    setAudioBuffer(null);
    setCurrentTime(0);
    setIsReviewingHistory(false);
  };

  const handleConfigSubmit = async () => {
    setError(null);
    
    if (config.mode === ExerciseMode.DICTATION) {
      setLoading(true);
      try {
        const ctx = initAudio();
        
        // 1. Generate text
        const dictation = await GeminiService.generateDictationText(config);
        setDictationData(dictation);

        // 2. Generate audio
        const base64 = await GeminiService.generateSpeech(dictation.text);
        
        // 3. Decode
        const buffer = await decodeAudioData(base64, ctx);
        setAudioBuffer(buffer);

        setStep('exercise');
      } catch (err: any) {
        setError("Erreur lors de la génération : " + err.message);
      } finally {
        setLoading(false);
      }
    } else {
      setStep('exercise');
    }
  };

  // --- Navigation & History Handlers ---

  const handleBack = () => {
    if (isReviewingHistory) {
      // If we were looking at details, go back to list
      setStep('history');
      setIsReviewingHistory(false);
      // Clear data to avoid confusion
      setAnalysis(null);
      setUserText('');
      setDictationData(null);
    } else if (step === 'history') {
      setStep('config');
    } else if (step === 'exercise') {
      handleReset(); // Going back from exercise resets to config
    } else if (step === 'reinforcement') {
       // Allow going back to analysis from exercises?
       // Probably safer to just reset or do nothing for now as logic is linear
       // For this implementation, let's treat it as "Home" for now
       handleReset();
    }
  };

  const loadHistoryItem = (record: SessionRecord) => {
    setConfig(record.config);
    setUserText(record.userText);
    setAnalysis(record.analysis);
    setDictationData(record.originalDictation || null);
    setIsReviewingHistory(true);
    setStep('analysis');
    setExercises([]); // Clear exercises as we don't save them
    setQuizAnswers({});
  };

  const deleteHistoryItem = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  // --- Render Steps ---

  const renderConfig = () => (
    <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-xl overflow-hidden">
      <div className="bg-indigo-600 p-8 text-white">
        <h2 className="text-3xl font-bold mb-2">Bonjour ! 👋</h2>
        <p className="text-indigo-100">Je suis votre tuteur de français. Configurons votre séance.</p>
      </div>
      <div className="p-8 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Votre Niveau</label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {Object.values(FrenchLevel).map((level) => (
              <button
                key={level}
                onClick={() => setConfig({ ...config, level })}
                className={`p-3 rounded-lg border text-sm font-medium transition-all ${
                  config.level === level 
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600' 
                    : 'border-gray-200 hover:border-indigo-300 text-gray-600'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Thème de travail</label>
          <input
            type="text"
            value={config.theme}
            onChange={(e) => setConfig({ ...config, theme: e.target.value })}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
            placeholder="Ex: Voyage, Affaires, Littérature..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Mode d'exercice</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => setConfig({ ...config, mode: ExerciseMode.DICTATION })}
              className={`flex items-center p-4 rounded-xl border-2 transition-all ${
                config.mode === ExerciseMode.DICTATION
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-900'
                  : 'border-gray-200 hover:border-gray-300 text-gray-600'
              }`}
            >
              <div className="bg-white p-2 rounded-full shadow-sm mr-4">
                <Mic className="w-6 h-6 text-indigo-600" />
              </div>
              <div className="text-left">
                <div className="font-semibold">Dictée Classique</div>
                <div className="text-xs opacity-75">J'écoute et j'écris</div>
              </div>
            </button>
            
            <button
              onClick={() => setConfig({ ...config, mode: ExerciseMode.CORRECTION })}
              className={`flex items-center p-4 rounded-xl border-2 transition-all ${
                config.mode === ExerciseMode.CORRECTION
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-900'
                  : 'border-gray-200 hover:border-gray-300 text-gray-600'
              }`}
            >
               <div className="bg-white p-2 rounded-full shadow-sm mr-4">
                <PenTool className="w-6 h-6 text-indigo-600" />
              </div>
              <div className="text-left">
                <div className="font-semibold">Correction de texte</div>
                <div className="text-xs opacity-75">Je soumets mon texte</div>
              </div>
            </button>
          </div>
        </div>

        <div className="pt-4 space-y-3">
          <Button onClick={handleConfigSubmit} className="w-full">
            Commencer la séance <ArrowRight className="w-5 h-5" />
          </Button>
          <Button 
            onClick={() => setStep('history')} 
            variant="outline" 
            className="w-full"
          >
            <History className="w-5 h-5" />
            Voir mon historique
          </Button>
        </div>
      </div>
    </div>
  );

  const renderHistory = () => (
    <div className="max-w-4xl mx-auto">
       <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <History className="text-indigo-600" />
          Historique des sessions
        </h2>
       </div>

       {history.length === 0 ? (
         <div className="bg-white rounded-2xl p-12 text-center text-gray-500 shadow-sm border border-gray-200">
           <History className="w-16 h-16 mx-auto mb-4 text-gray-300" />
           <p className="text-lg">Aucune session enregistrée pour le moment.</p>
           <p className="text-sm mt-2">Commencez une dictée ou une correction pour voir vos résultats ici.</p>
           <Button onClick={handleBack} variant="outline" className="mt-6 mx-auto">
             Retour à l'accueil
           </Button>
         </div>
       ) : (
         <div className="grid gap-4">
           {history.map((record) => (
             <div 
               key={record.id} 
               onClick={() => loadHistoryItem(record)}
               className="bg-white p-5 rounded-xl shadow-sm hover:shadow-md border border-gray-200 transition-all cursor-pointer group relative"
             >
               <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                 <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-lg ${record.config.mode === ExerciseMode.DICTATION ? 'bg-purple-100 text-purple-600' : 'bg-teal-100 text-teal-600'}`}>
                      {record.config.mode === ExerciseMode.DICTATION ? <Mic size={20} /> : <PenTool size={20} />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900">{record.config.theme}</span>
                        <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600 border border-gray-200">
                          {record.config.level.split(' ')[0]}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <Calendar size={14} /> {formatDate(record.date)}
                        </span>
                        <span className={`font-medium ${record.analysis.mistakes.length === 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {record.analysis.mistakes.length} erreur{record.analysis.mistakes.length > 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                 </div>
                 
                 <div className="flex items-center gap-3">
                   <div className="text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity font-medium text-sm flex items-center">
                     Voir le détail <ArrowRight size={16} className="ml-1" />
                   </div>
                   <button 
                    onClick={(e) => deleteHistoryItem(e, record.id)}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors z-10"
                    title="Supprimer"
                   >
                     <Trash2 size={18} />
                   </button>
                 </div>
               </div>
             </div>
           ))}
         </div>
       )}
    </div>
  );

  const renderExercise = () => (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-3">
          {config.mode === ExerciseMode.DICTATION ? <Mic className="text-indigo-600" /> : <PenTool className="text-indigo-600" />}
          {config.mode === ExerciseMode.DICTATION ? "Écoutez et écrivez" : "Rédigez ou collez votre texte"}
        </h2>

        {config.mode === ExerciseMode.DICTATION && (
          <div className="mb-8 p-6 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="w-full max-w-md bg-white p-4 rounded-lg shadow-sm mb-2 text-center text-gray-500 italic text-sm">
                Utilisez le lecteur ci-dessous pour écouter la dictée générée par Gemini.
              </div>
              
              <Button 
                onClick={togglePlayAudio}
                className={`min-w-[200px] ${isPlaying ? 'bg-indigo-700' : ''}`}
                disabled={!audioBuffer}
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                {isPlaying ? "Arrêter" : "Écouter la dictée"}
              </Button>

              {audioBuffer && (
                <div className="w-full max-w-md mt-2 space-y-2">
                  <div className="flex justify-between text-xs font-medium text-gray-500">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(audioBuffer.duration)}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-indigo-600 h-full rounded-full transition-all duration-100 ease-linear"
                      style={{ width: `${Math.min((currentTime / audioBuffer.duration) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {dictationData?.translation && (
                 <details className="w-full max-w-lg mt-4 text-sm text-gray-500 cursor-pointer">
                   <summary className="hover:text-indigo-600 text-center list-none">Besoin d'aide ? Voir la traduction (anglais)</summary>
                   <div className="mt-2 p-3 bg-yellow-50 text-yellow-800 rounded border border-yellow-200">
                     {dictationData.translation}
                   </div>
                 </details>
              )}
            </div>
          </div>
        )}

        <div className="relative">
          <textarea
            value={userText}
            onChange={(e) => setUserText(e.target.value)}
            placeholder={config.mode === ExerciseMode.DICTATION ? "Écrivez ce que vous entendez..." : "Saisissez votre texte ici..."}
            className="w-full h-64 p-6 text-lg leading-relaxed bg-white border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:ring-0 resize-none transition-colors"
            spellCheck={false}
          />
          <div className="absolute bottom-4 right-4 text-sm text-gray-400">
            {userText.length} caractères
          </div>
        </div>

        <div className="mt-8 flex justify-end">
          <Button onClick={handleSubmitText} disabled={!userText.trim()}>
            Soumettre pour analyse <CheckCircle className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  );

  const renderAnalysis = () => (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* History Banner */}
      {isReviewingHistory && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-indigo-800">
             <History size={20} />
             <span className="font-medium">Mode Révision d'Historique</span>
          </div>
          <div className="text-sm text-indigo-600">
            Session du {dictationData ? 'Dictée' : 'Correction'}
          </div>
        </div>
      )}

      {/* Feedback Card */}
      <div className="bg-indigo-900 text-white rounded-2xl shadow-xl p-8">
        <div className="flex items-start gap-4">
          <div className="bg-white/10 p-3 rounded-lg">
            <BookOpen className="w-8 h-8 text-indigo-300" />
          </div>
          <div>
            <h3 className="text-xl font-bold mb-2">Feedback du Professeur</h3>
            <p className="text-indigo-100 leading-relaxed italic">"{analysis?.feedback}"</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Corrected Text */}
        <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-500" />
            Texte Corrigé
          </h3>
          <div className="prose prose-lg text-gray-700 bg-green-50/50 p-6 rounded-xl border border-green-100">
             {/* Using dangerouslySetInnerHTML safely here as content is from Gemini with specific instruction */}
             <div dangerouslySetInnerHTML={{ __html: analysis?.correctedTextWithMarkup.replace(/\*\*(.*?)\*\*/g, '<strong class="text-green-700 bg-green-200 px-1 rounded">$1</strong>') || '' }} />
          </div>
        </div>

        {/* Your Text (for reference) */}
        <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 opacity-75">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <PenTool className="w-5 h-5 text-gray-400" />
            Ce que vous avez écrit
          </h3>
          <div className="text-gray-600 p-6 bg-gray-50 rounded-xl border border-gray-100 whitespace-pre-wrap">
            {userText}
          </div>
        </div>
      </div>

      {/* Mistakes Table */}
      {analysis && analysis.mistakes.length > 0 && (
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-200">
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
            <h3 className="font-bold text-gray-800">Détail des erreurs</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-sm uppercase tracking-wider">
                  <th className="px-6 py-4 font-medium">Votre erreur</th>
                  <th className="px-6 py-4 font-medium">Correction</th>
                  <th className="px-6 py-4 font-medium">Type</th>
                  <th className="px-6 py-4 font-medium">Règle à retenir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {analysis.mistakes.map((mistake, i) => (
                  <tr key={i} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-red-600 font-medium bg-red-50/30">{mistake.original}</td>
                    <td className="px-6 py-4 text-green-700 font-medium bg-green-50/30">{mistake.correction}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      <span className="px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold">
                        {mistake.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{mistake.rule}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isReviewingHistory && (
        <div className="flex justify-center pt-4">
          <Button onClick={handleStartExercises} size="lg">
            Pratiquer ces points faibles <ArrowRight className="w-5 h-5" />
          </Button>
        </div>
      )}
    </div>
  );

  const renderReinforcement = () => (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-800">Exercices de Renforcement</h2>
        <p className="text-gray-600">Ciblés sur vos erreurs précédentes pour vous améliorer.</p>
      </div>

      {exercises.map((ex, idx) => {
        const isAnswered = quizAnswers[ex.id] !== undefined;
        const isCorrect = quizAnswers[ex.id] === ex.correctAnswer;
        
        return (
          <div key={ex.id} className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100 transition-all hover:shadow-xl">
            <div className="p-6 border-b border-gray-100 bg-slate-50">
              <span className="text-xs font-bold text-indigo-500 uppercase tracking-wide mb-2 block">Exercice {idx + 1}</span>
              <p className="text-lg font-medium text-gray-800">{ex.question}</p>
            </div>
            <div className="p-6 space-y-3">
              {ex.options.map((option) => (
                <button
                  key={option}
                  disabled={isAnswered}
                  onClick={() => setQuizAnswers(prev => ({ ...prev, [ex.id]: option }))}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all flex justify-between items-center
                    ${!isAnswered ? 'hover:border-indigo-200 hover:bg-indigo-50 border-gray-100' : ''}
                    ${isAnswered && option === ex.correctAnswer ? 'bg-green-50 border-green-500 text-green-800' : ''}
                    ${isAnswered && option === quizAnswers[ex.id] && option !== ex.correctAnswer ? 'bg-red-50 border-red-500 text-red-800' : ''}
                    ${isAnswered && option !== ex.correctAnswer && option !== quizAnswers[ex.id] ? 'opacity-50 border-transparent' : ''}
                  `}
                >
                  <span>{option}</span>
                  {isAnswered && option === ex.correctAnswer && <CheckCircle className="w-5 h-5 text-green-600" />}
                  {isAnswered && option === quizAnswers[ex.id] && option !== ex.correctAnswer && <AlertCircle className="w-5 h-5 text-red-600" />}
                </button>
              ))}
            </div>
            {isAnswered && (
              <div className={`px-6 py-4 ${isCorrect ? 'bg-green-100 text-green-800' : 'bg-indigo-50 text-indigo-800'} border-t`}>
                <p className="font-semibold text-sm mb-1">{isCorrect ? "Excellent !" : "Explication :"}</p>
                <p className="text-sm opacity-90">{ex.explanation}</p>
              </div>
            )}
          </div>
        );
      })}

      <div className="flex justify-center pt-8 pb-12">
        <Button onClick={handleReset} variant="outline">
          <RotateCcw className="w-5 h-5" />
          Nouvelle Session
        </Button>
      </div>
    </div>
  );

  // Logic to determine if Back Button should be visible
  const showBackButton = step !== 'config';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      {loading && <LoadingOverlay message="Le professeur réfléchit..." />}
      
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {showBackButton && (
              <button 
                onClick={handleBack}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500 hover:text-indigo-600"
                aria-label="Retour"
              >
                <ArrowLeft size={20} />
              </button>
            )}
            <div onClick={handleReset} className="flex items-center gap-2 cursor-pointer">
              <div className="bg-indigo-600 p-2 rounded-lg text-white">
                <BookOpen size={20} />
              </div>
              <h1 className="text-xl font-bold text-gray-900 hidden sm:block">Professeur AI</h1>
            </div>
          </div>
          {config.level && step !== 'history' && !isReviewingHistory && (
            <div className="hidden sm:flex items-center gap-4 text-sm text-gray-500">
              <span className="bg-gray-100 px-3 py-1 rounded-full">{config.level.split(' ')[0]}</span>
              <span>{config.mode === ExerciseMode.DICTATION ? 'Dictée' : 'Correction'}</span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="max-w-2xl mx-auto mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {/* Don't show step wizard on config or history screen to keep it clean */}
        {step !== 'config' && step !== 'history' && !isReviewingHistory && (
          <StepWizard currentStep={step as any} />
        )}

        <div className="mt-8">
          {step === 'config' && renderConfig()}
          {step === 'history' && renderHistory()}
          {step === 'exercise' && renderExercise()}
          {step === 'analysis' && renderAnalysis()}
          {step === 'reinforcement' && renderReinforcement()}
        </div>
      </main>
    </div>
  );
}