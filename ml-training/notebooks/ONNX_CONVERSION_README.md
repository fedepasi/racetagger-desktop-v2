# RF-DETR to ONNX - Google Colab Notebook

## 📓 Notebook Disponibile

**[RF_DETR_to_ONNX_Conversion_Colab.ipynb](./RF_DETR_to_ONNX_Conversion_Colab.ipynb)**

Notebook Jupyter interattivo per convertire modelli RF-DETR (`.pt`) in formato ONNX usando Google Colab.

## 🚀 Come Usare

### Opzione 1: Google Colab (Raccomandato)

1. **Apri il notebook**
   - Vai su [Google Colab](https://colab.research.google.com/)
   - File → Upload → Seleziona `RF_DETR_to_ONNX_Conversion_Colab.ipynb`

2. **Esegui le celle in ordine**
   - ✅ **Cella 1**: Installa dipendenze (2-3 minuti)
   - ✅ **Cella 2**: Upload del file `.pt` (o monta Google Drive)
   - ✅ **Cella 3**: Analisi checkpoint (auto-detect model size)
   - ✅ **Cella 4**: Conversione ONNX (1-2 minuti)
   - ✅ **Cella 5**: Test inferenza (opzionale)
   - ✅ **Cella 6**: Download file `.onnx`

3. **Scarica il risultato**
   - Il file `.onnx` viene scaricato automaticamente
   - Copia il checksum SHA256 per upload al Management Portal

### Opzione 2: Jupyter Locale

```bash
cd ml-training/notebooks

# Attiva virtual environment
source ../venv-ml/bin/activate

# Installa Jupyter (se non già fatto)
pip install jupyter

# Avvia notebook
jupyter notebook RF_DETR_to_ONNX_Conversion_Colab.ipynb
```

## 📋 Cosa Fa il Notebook

### Automatico
- ✅ Installazione dipendenze (rfdetr, onnx, torch)
- ✅ Rilevamento automatico model size
- ✅ Conversione con legacy exporter (PyTorch 2.9+ compatible)
- ✅ Verifica e semplificazione ONNX
- ✅ Calcolo checksum SHA256
- ✅ Test inferenza opzionale

### Input Richiesto
- File `.pt` o `.pth` del modello trainato
- (Opzionale) Resolution custom se auto-detect fallisce

### Output
- File `.onnx` convertito
- Checksum SHA256
- Report con info modello (size, resolution, etc.)

## ⚡ Vantaggi Google Colab

- ✅ **No setup locale**: Nessuna installazione su computer
- ✅ **GPU gratuita**: T4 GPU per accelerazione (se disponibile)
- ✅ **RAM abbondante**: 12-13 GB RAM gratuiti
- ✅ **Cloud storage**: Salva in Google Drive direttamente
- ✅ **Multi-platform**: Funziona da Windows/Mac/Linux

## 🎯 Quando Usare il Notebook

**Usa il notebook Colab quando:**
- Non vuoi installare dipendenze localmente
- Hai un computer con RAM limitata
- Vuoi conversione guidata step-by-step
- Preferisci interfaccia visuale interattiva
- Hai file sul Google Drive

**Usa gli script Python quando:**
- Vuoi automazione completa (batch processing)
- Hai già ambiente locale configurato
- Preferisci CLI/terminale
- Vuoi integrare in pipeline CI/CD

## 📊 Struttura Notebook

```
1. Setup & Installazione
   ├─ pip install dipendenze
   └─ Import librerie

2. Upload Modello
   ├─ Option A: Upload manuale
   └─ Option B: Google Drive mount

3. Ispezione Checkpoint
   ├─ Analisi args.resolution
   ├─ Analisi args.hidden_dim
   └─ Auto-detect model type

4. Conversione ONNX
   ├─ Caricamento modello
   ├─ Preparazione export
   ├─ torch.onnx.export (dynamo=False)
   ├─ onnx.checker.check_model()
   └─ onnxsim.simplify()

5. Test (Opzionale)
   ├─ Caricamento ONNX Runtime
   ├─ Test inference
   └─ Verifica output shapes

6. Download
   └─ files.download() → file .onnx
```

## 🔧 Customizzazione

Se l'auto-detect fallisce, puoi modificare manualmente:

```python
# Nella cella "Conversione ONNX", modifica:
model_type = 'RFDETRSmall'  # Uncomment e modifica
resolution = 512             # Uncomment e modifica
```

Model types supportati:
- `RFDETRNano` (res: 384)
- `RFDETRSmall` (res: 512)
- `RFDETRMedium` (res: 576)
- `RFDETRBase` (res: 560, hidden: 256)
- `RFDETRLarge` (res: 560, hidden: 384)
- `RFDETRSegPreview` (segmentation)

## ⚠️ Note Importanti

### PyTorch 2.9+ Compatibility
Il notebook usa automaticamente `dynamo=False` per compatibilità con PyTorch 2.9+.

### MPS Fallback (Mac M-series)
Se usi localmente su Mac M-series, il notebook forza CPU con `.cpu()` per evitare problemi MPS.

### Limiti Google Colab

**Versione Gratuita:**
- Timeout: 12 ore max sessione
- RAM: ~12 GB
- Disco: ~100 GB
- GPU: T4 (quando disponibile, non garantita)

**Colab Pro (€10/mese):**
- Timeout: 24 ore
- RAM: ~25 GB
- GPU priority: P100/V100

## 📚 Documentazione Completa

Per dettagli completi su metodi alternativi, troubleshooting e post-processing:

➡️ **[../CONVERSION_GUIDE.md](../CONVERSION_GUIDE.md)**

---

## 🆘 Troubleshooting

### Cella "Installazione" fallisce

**Problema**: Timeout o errori pip

**Soluzione**:
```python
# Nella cella installazione, aggiungi:
!pip install --no-cache-dir rfdetr==1.3.0 onnx==1.19.0 ...
```

### Upload fallisce (file > 100 MB)

**Problema**: Timeout durante upload

**Soluzione**: Usa Google Drive mount invece di upload manuale
```python
from google.colab import drive
drive.mount('/content/drive')
checkpoint_path = '/content/drive/MyDrive/path/to/model.pt'
```

### Auto-detect fallisce

**Problema**: `model_type = 'Unknown'`

**Soluzione**: Modifica manualmente nella cella conversione (vedi sezione Customizzazione)

### Conversione lenta

**Problema**: >5 minuti per convertire

**Possibili cause**:
- Modello molto grande (>500 MB)
- Colab senza GPU assegnata
- Semplificazione ONNX lenta

**Soluzione**: Disabilita semplificazione temporaneamente
```python
# Nella cella conversione, commenta:
# model_simplified, check = simplify(onnx_model)
```

---

**Creato per**: RaceTagger Desktop
**Ultimo aggiornamento**: 2026-01-18
**Versioni testate**: PyTorch 2.8.0, ONNX 1.19.0, rfdetr 1.3.0
