import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { getSharp } from './utils/native-modules';
import { app } from 'electron';
import * as ExifReader from 'exifreader';
import * as piexif from 'piexifjs';
// Define CSV reference entry type locally since test-service was removed
export interface CsvReferenceEntry {
  numero: string;
  filename?: string;
  url?: string;
  alt_tag?: string;
  nome?: string;
  categoria?: string;
  squadra?: string;
  [key: string]: string | undefined;
}

// Importa sharp in modo sicuro
const sharpModule = getSharp();

/**
 * Interfaccia che rappresenta l'analisi di un numero di gara 
 */
export interface RaceNumberAnalysis {
  raceNumber: string | null;    // Numero di gara rilevato
  confidence: number;           // Livello di confidenza (0-1)
  drivers?: string[];           // Nomi piloti (opzionale)
  teamName?: string | null;     // Nome team (opzionale)
  category?: string | null;     // Categoria (opzionale)
  otherText?: string[];         // Altro testo rilevato (opzionale)
  boundingBox?: {               // Posizione del numero nell'immagine (opzionale)
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// Definisce i modelli disponibili per l'analisi
export enum AnalysisModel {
  GEMINI_FLASH = 'gemini-2.5-flash',      // Modello Gemini 2.5 Flash
  GEMINI_FLASH_LITE = 'gemini-2.5-flash-lite', // Modello Gemini 2.5 Flash-Lite
  GEMINI_PRO = 'gemini-2.5-pro',          // Modello Gemini 2.5 Pro
  DESKTOP = 'analyzeImageDesktopV2',                    // Usa il metodo analyzeImageDesktopV2
  WEB = 'analyzeImageWeb',                              // Usa il metodo analyzeImageWeb
  ADMIN = 'analyzeImageAdmin',                          // Usa il metodo analyzeImageAdmin
  
  // Modelli legacy mantenuti per retrocompatibilità
  LOCAL_BASIC = 'local-basic',          
  LOCAL_ADVANCED = 'local-advanced',    
  LOCAL_FILENAME = 'local-filename',   
  CLOUD_DEFAULT = 'cloud-default',      
  CLOUD_ACCURATE = 'cloud-accurate'
}

/**
 * Componente di analisi dei numeri di gara che utilizza la logica locale
 * Questa classe fornisce metodi per analizzare le immagini e rilevare numeri di gara
 * senza dover utilizzare le Edge Functions
 */
export class LocalRaceNumberAnalyzer {
  private tempDir: string;
  private modelName: string;
  private csvEntries?: CsvReferenceEntry[];
  private fileNameMap: Map<string, CsvReferenceEntry>;
  
  constructor(modelName: string = AnalysisModel.DESKTOP) {
    this.modelName = modelName;
    this.tempDir = path.join(app.getPath('userData'), 'temp-analysis');
    this.fileNameMap = new Map<string, CsvReferenceEntry>();
    
    // Crea la directory temporanea se non esiste
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    console.log(`LocalRaceNumberAnalyzer: Initialized with model ${modelName}`);
  }
  
  /**
   * Imposta i dati di riferimento CSV per l'analisi
   * @param entries Dati CSV di riferimento
   */
  public setCsvData(entries: CsvReferenceEntry[]): void {
    this.csvEntries = entries;
    
    // Crea mappa per lookup veloce per filename
    this.fileNameMap.clear();
    entries.forEach(entry => {
      if (entry.filename) {
        this.fileNameMap.set(entry.filename, entry);
      }
    });
    
    console.log(`Set ${entries.length} CSV entries, ${this.fileNameMap.size} with filenames`);
  }
  
  /**
   * Analizza un'immagine e rileva il numero di gara
   * Questa è una versione locale e semplificata dell'analisi (solo per testing)
   * @param imagePath Percorso dell'immagine da analizzare
   * @returns Risultato dell'analisi con numero di gara e confidenza
   */
  public async analyzeImage(imagePath: string): Promise<RaceNumberAnalysis> {
    try {
      console.log(`LocalRaceNumberAnalyzer: Analyzing image ${imagePath} using model ${this.modelName}`);
      
      // Simula un ritardo realistico per l'elaborazione dell'immagine
      // Il ritardo dipende dal modello: più preciso = più lento
      const delayMs = this.getAnalysisDelay();
      await new Promise(resolve => setTimeout(resolve, delayMs));
      
      console.log(`Elaborazione dell'immagine ${path.basename(imagePath)} completata in ${delayMs}ms`);
      
      // 1. Verifica esistenza del file
      if (!fs.existsSync(imagePath)) {
        throw new Error(`File not found: ${imagePath}`);
      }
      
      // 2. Ottieni informazioni EXIF se disponibili (per uso futuro)
      let exifData = null;
      try {
        const imageBuffer = await fsPromises.readFile(imagePath);
        exifData = ExifReader.load(imageBuffer);
      } catch (exifError) {
        console.log(`EXIF extraction error: ${exifError}`);
      }
      
      // Ottieni il nome del file
      const fileName = path.basename(imagePath);
      
      // Varia la strategia di analisi in base al modello selezionato
      let extractedNumber: string | null = null;
      let confidence = 0;
      
      // Controlla se abbiamo una corrispondenza nel CSV per il filename
      const csvMatch = this.fileNameMap.get(fileName);
      
      // Applica la strategia di analisi in base al modello selezionato
      switch (this.modelName) {
        case AnalysisModel.GEMINI_FLASH:
        case AnalysisModel.GEMINI_PRO:
        case AnalysisModel.DESKTOP:
        case AnalysisModel.WEB:
        case AnalysisModel.ADMIN:
          // Se abbiamo una corrispondenza nel CSV, usala come ground truth
          if (csvMatch) {
            // Simula prestazioni diverse in base al modello
            // Gemini Pro e Admin sono i più accurati, seguiti da Gemini Flash e Web, Desktop è il più basic
            const isHighAccuracy = 
              this.modelName === AnalysisModel.GEMINI_PRO || 
              this.modelName === AnalysisModel.ADMIN;
            const isMediumAccuracy = 
              this.modelName === AnalysisModel.GEMINI_FLASH || 
              this.modelName === AnalysisModel.WEB;
              
            const correctDetectionProb = isHighAccuracy ? 0.95 : (isMediumAccuracy ? 0.85 : 0.75);
            
            if (Math.random() < correctDetectionProb) {
              // Rilevamento corretto
              extractedNumber = csvMatch.numero;
              confidence = isHighAccuracy 
                ? 0.9 + (Math.random() * 0.1)    // 0.9-1.0 per alta precisione
                : (isMediumAccuracy 
                  ? 0.8 + (Math.random() * 0.15) // 0.8-0.95 per media precisione
                  : 0.7 + (Math.random() * 0.2)); // 0.7-0.9 per bassa precisione
            } else {
              // Simula rilevamento errato o mancato
              if (Math.random() < 0.5) {
                // Falso positivo: numero sbagliato
                const wrongNumber = parseInt(csvMatch.numero) + (Math.random() > 0.5 ? 1 : -1);
                extractedNumber = Math.max(1, wrongNumber).toString();
                confidence = isHighAccuracy
                  ? 0.7 + (Math.random() * 0.2)
                  : (isMediumAccuracy 
                    ? 0.6 + (Math.random() * 0.2)
                    : 0.5 + (Math.random() * 0.2));
              } else {
                // Falso negativo: nessun rilevamento
                extractedNumber = null;
                confidence = 0;
              }
            }
          } else {
            // Simula analisi basata sul nome file (senza ground truth)
            const fileNameMatch = fileName.match(/^(\d+)_/);
            if (fileNameMatch) {
              extractedNumber = fileNameMatch[1];
              confidence = Math.random() > 0.3 
                ? 0.7 + (Math.random() * 0.3) // Buona confidenza per pattern chiari
                : 0.4 + (Math.random() * 0.3); // Confidenza più bassa in alcuni casi
            } else {
              const numberMatches = fileName.match(/\d+/g);
              const detectionProb = this.modelName === AnalysisModel.GEMINI_PRO ? 0.7 : 0.5;
              
              if (numberMatches && numberMatches.length > 0 && Math.random() < detectionProb) {
                extractedNumber = numberMatches[0];
                confidence = 0.4 + (Math.random() * 0.3);
              } else {
                extractedNumber = null;
                confidence = 0;
              }
            }
          }
          break;
          
        case AnalysisModel.LOCAL_FILENAME:
          // Modello che estrae numeri solo dal CSV con filename o dal nome file
          if (csvMatch) {
            // Se abbiamo un match nel CSV, usa il numero di gara dal CSV
            extractedNumber = csvMatch.numero;
            confidence = 1.0; // Confidenza massima (dato di riferimento)
            console.log(`Using CSV match for ${fileName}: race number ${extractedNumber}`);
          } else {
            // Altrimenti cerca il pattern nel nome file (numero_*.jpg)
            const fileNameMatch = fileName.match(/^(\d+)_/);
            if (fileNameMatch) {
              extractedNumber = fileNameMatch[1];
              confidence = 0.9; // Alta confidenza (pattern riconosciuto)
              console.log(`Extracted race number ${extractedNumber} from filename pattern`);
            } else {
              console.log(`No CSV match or filename pattern for ${fileName}`);
              extractedNumber = null;
              confidence = 0;
            }
          }
          break;
          
        case AnalysisModel.LOCAL_ADVANCED:
          // Modello avanzato che combina diverse strategie
          // Priorità: 1. CSV match, 2. Pattern del nome file, 3. Cerca numeri nel nome file
          
          if (csvMatch) {
            // Se abbiamo un match nel CSV, usa il numero di gara dal CSV
            extractedNumber = csvMatch.numero;
            confidence = 0.95; // Alta confidenza ma non assoluta
          } else {
            // Cerca il pattern nel nome file (numero_*.jpg)
            const fileNameMatch = fileName.match(/^(\d+)_/);
            if (fileNameMatch) {
              extractedNumber = fileNameMatch[1];
              confidence = 0.8 + (Math.random() * 0.15); // Confidenza variabile ma alta
            } else {
              // Simula un OCR più avanzato che può trovare numeri anche senza pattern specifici
              // Simula l'estrazione del numero dalla posizione in cui di solito si trova
              const randomValue = Math.random();
              
              if (randomValue > 0.4) { // 60% di probabilità di rilevamento
                // Estrae un numero dal nome file o lo genera casualmente
                const numberMatches = fileName.match(/\d+/g);
                if (numberMatches && numberMatches.length > 0) {
                  // Prende il primo numero trovato nel nome
                  extractedNumber = numberMatches[0];
                  confidence = 0.5 + (Math.random() * 0.3);
                } else {
                  // Se proprio non trova numeri, ne genera uno casuale
                  extractedNumber = Math.floor(Math.random() * 900 + 100).toString();
                  confidence = 0.4 + (Math.random() * 0.2);
                }
              } else {
                extractedNumber = null;
                confidence = 0;
              }
            }
          }
          break;
          
        case AnalysisModel.CLOUD_DEFAULT:
        case AnalysisModel.CLOUD_ACCURATE:
          // Simula analisi cloud con prestazioni diverse in base al modello
          const isAccurate = this.modelName === AnalysisModel.CLOUD_ACCURATE;
          
          // Se abbiamo un match nel CSV, usiamolo come "ground truth" e simuliamo
          // un'analisi efficace ma con accuratezza diversa in base al modello
          if (csvMatch) {
            const correctDetectionProb = isAccurate ? 0.95 : 0.8; // 95% vs 80% di probabilità
            
            if (Math.random() < correctDetectionProb) {
              // Simula rilevamento corretto
              extractedNumber = csvMatch.numero;
              confidence = isAccurate 
                ? 0.85 + (Math.random() * 0.15) // 0.85-1.0 per accurate
                : 0.75 + (Math.random() * 0.15); // 0.75-0.9 per default
            } else {
              // Simula rilevamento errato o mancato
              if (Math.random() < 0.5) {
                // Falso positivo: numero sbagliato
                const wrongNumber = parseInt(csvMatch.numero) + (Math.random() > 0.5 ? 1 : -1);
                extractedNumber = Math.max(1, wrongNumber).toString();
                confidence = isAccurate
                  ? 0.6 + (Math.random() * 0.2) // 0.6-0.8 per accurate
                  : 0.5 + (Math.random() * 0.2); // 0.5-0.7 per default
              } else {
                // Falso negativo: nessun rilevamento
                extractedNumber = null;
                confidence = 0;
              }
            }
          } else {
            // Senza riferimento, simuliamo un'analisi basata sul nome file
            const fileNameMatch = fileName.match(/^(\d+)_/);
            if (fileNameMatch) {
              // Pattern chiaro nel nome file
              extractedNumber = fileNameMatch[1];
              confidence = isAccurate
                ? 0.8 + (Math.random() * 0.2) // 0.8-1.0 per accurate
                : 0.7 + (Math.random() * 0.2); // 0.7-0.9 per default
            } else {
              // Nessun pattern chiaro, simula estrazione più complessa
              const numberMatches = fileName.match(/\d+/g);
              const detectionProb = isAccurate ? 0.7 : 0.5; // 70% vs 50% di probabilità
              
              if (numberMatches && numberMatches.length > 0 && Math.random() < detectionProb) {
                extractedNumber = numberMatches[0];
                confidence = isAccurate
                  ? 0.6 + (Math.random() * 0.3) // 0.6-0.9 per accurate
                  : 0.4 + (Math.random() * 0.3); // 0.4-0.7 per default
              } else {
                // Nessun rilevamento o non abbastanza confidenza
                extractedNumber = null;
                confidence = 0;
              }
            }
          }
          break;
          
        case AnalysisModel.LOCAL_BASIC:
        default:
          // Modello base (comportamento originale)
          // Cerca il pattern nel nome file (numero_*.jpg)
          const fileNameMatch = fileName.match(/^(\d+)_/);
          
          if (fileNameMatch) {
            extractedNumber = fileNameMatch[1];
            // Simula una confidenza variabile per test più realistici
            confidence = 0.7 + (Math.random() * 0.3);
          } else {
            // Se non troviamo un numero nel nome, come fallback possiamo:
            // 1. Cercare numeri nel nome file (tecnica semplice)
            // 2. Simulare occasionalmente un rilevamento corretto o un falso positivo
            const randomValue = Math.random();
            
            if (randomValue > 0.7) {
              // Simula un rilevamento: genera un numero casuale di 1-3 cifre
              extractedNumber = Math.floor(Math.random() * 900 + 100).toString();
              confidence = 0.3 + (Math.random() * 0.4); // Confidenza più bassa
            } else {
              // Nessun rilevamento
              extractedNumber = null;
              confidence = 0;
            }
          }
          break;
      }
      
      // 5. Crea il risultato dell'analisi
      const result: RaceNumberAnalysis = {
        raceNumber: extractedNumber,
        confidence,
        drivers: [],
        teamName: null,
        category: null,
        otherText: []
      };
      
      // Aggiunge dati simulati all'analisi
      if (extractedNumber) {
        // In un caso reale, qui si aggiungerebbero dati dall'analisi OCR completa
        result.drivers = ['Driver ' + extractedNumber];
        result.category = randomCategory();
        result.teamName = 'Team ' + (Math.floor(Math.random() * 20) + 1);
      }
      
      return result;
    } catch (error) {
      console.error('Error in local analysis:', error);
      // In caso di errore ritorna un oggetto vuoto
      return {
        raceNumber: null,
        confidence: 0
      };
    }
  }
  
  /**
   * Determina il ritardo di analisi in base al modello
   * @returns Ritardo in millisecondi
   */
  private getAnalysisDelay(): number {
    // Diversi modelli hanno tempi di elaborazione simulati diversi
    switch (this.modelName) {
      case AnalysisModel.GEMINI_PRO:
      case AnalysisModel.ADMIN:
      case AnalysisModel.CLOUD_ACCURATE:
        return 800 + Math.floor(Math.random() * 500); // 800-1300ms (più lento ma più accurato)
        
      case AnalysisModel.GEMINI_FLASH:
      case AnalysisModel.WEB:
      case AnalysisModel.CLOUD_DEFAULT:
        return 400 + Math.floor(Math.random() * 300); // 400-700ms (velocità media)
        
      case AnalysisModel.LOCAL_ADVANCED:
        return 300 + Math.floor(Math.random() * 200); // 300-500ms
        
      case AnalysisModel.DESKTOP:
      case AnalysisModel.LOCAL_BASIC:
      case AnalysisModel.LOCAL_FILENAME:
      default:
        return 200 + Math.floor(Math.random() * 150); // 200-350ms (il più veloce)
    }
  }
  
  /**
   * Preprocessa un'immagine prima dell'analisi
   * @param imagePath Percorso dell'immagine
   * @returns Percorso dell'immagine preprocessata
   */
  private async preprocessImage(imagePath: string): Promise<string> {
    try {
      const outputPath = path.join(this.tempDir, `preproc_${Date.now()}_${path.basename(imagePath)}`);
      
      // Semplice copia del file, senza usar sharp per evitare problemi di compatibilità
      await fsPromises.copyFile(imagePath, outputPath);
      
      // NOTA: In una implementazione reale, qui si userebbe sharp o altra libreria
      // per preprocessare l'immagine (resize, grayscale, normalise, ecc.)
      
      return outputPath;
    } catch (error) {
      console.error('Error preprocessing image:', error);
      return imagePath; // In caso di errore, ritorna l'immagine originale
    }
  }
}

/**
 * Crea un'istanza del LocalRaceNumberAnalyzer
 * @param modelName Nome del modello di analisi da utilizzare
 * @returns Istanza dell'analizzatore
 */
export function createLocalAnalyzer(modelName: string = 'local-basic'): LocalRaceNumberAnalyzer {
  return new LocalRaceNumberAnalyzer(modelName);
}

// Utility per generare una categoria casuale (per simulazione)
function randomCategory(): string {
  const categories = ['Elite', 'Junior', 'Amateur', 'Senior', 'Master'];
  const index = Math.floor(Math.random() * categories.length);
  return categories[index];
}
