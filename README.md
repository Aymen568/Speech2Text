# Speech2Text

Speech2Text is an API that transcribes audio files into text using advanced speech recognition technology.

## Key Functionalities
- Transcribes audio files in various formats.
- Supports multiple languages.
- Provides accurate transcription with minimal errors.

## Setup Steps
1. Clone the repository:
   ```bash
   git clone https://github.com/Aymen568/Speech2Text.git
   cd Speech2Text
   ```
2. Install the required dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Create a .env file in the root directory and add the required variables:
   ```dotenv
   SPEECHMATICS_API_KEY=your_speechmatics_api_key
   SPEECH_LANGUAGE=your_preferred_language
   GOOGLE_API_KEY=your_google_api_key
   ```

## Running the API
To run the API, navigate to the `transcribeService` directory and start the server using:
```bash
cd transcribeService
uvicorn main:app --host 0.0.0.0 --port 8000
```