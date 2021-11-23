import type { protos } from "@google-cloud/speech";
import * as functions from "firebase-functions";
// @ts-ignore
import * as formidable from "formidable-serverless";

const uploadFileFromPath = async (
  bucketName: string,
  filePath: string,
  destination: string,
  contentType: string
): Promise<string> => {
  const { Storage } = await import("@google-cloud/storage");
  const storage = new Storage();

  const res = await storage.bucket(bucketName).upload(filePath, {
    destination,
    contentType,
  });

  return `gs://${bucketName}/${res[1].name}`;
};

const uploadDoc = async (
  bucketName: string,
  fileName: string,
  data: string,
  contentType: string
) => {
  const { Storage } = await import("@google-cloud/storage");
  const storage = new Storage();

  const name = fileName + ".doc";

  const file = storage.bucket(bucketName).file(name);
  const contents = JSON.stringify(data, null, 2);

  await file.save(contents, {
    contentType,
    public: true,
  });

  return file.publicUrl();
};

const transcribe = async (gcsPath: string) => {
  const { SpeechClient } = await import("@google-cloud/speech");
  const speechClient = new SpeechClient({
    projectId: "384759915560",
    keyFilename: require.resolve("../adminkey.json"),
  });

  const audio = {
    uri: gcsPath,
  };

  const config: protos.google.cloud.speech.v1.IRecognitionConfig = {
    sampleRateHertz: 16000,
    encoding: "FLAC",
    languageCode: "sv-SE",
    enableAutomaticPunctuation: true,
    model: "default",
  };

  const request: protos.google.cloud.speech.v1.IRecognizeRequest = {
    audio,
    config,
  };

  const [operation] = await speechClient.longRunningRecognize(request);

  const [response] = await operation.promise();
  const transcription = (
    response.results as protos.google.cloud.speech.v1.ISpeechRecognitionResult[]
  ).map((result) => result.alternatives && result.alternatives[0].transcript);

  return transcription.join();
};

export const speechToText = functions
  .region("europe-west3")
  .runWith({ memory: "8GB", timeoutSeconds: 540 })
  .https.onRequest(async (req, res) => {
    const bucket = "tts-api-791bc.appspot.com";
    const form = new formidable.IncomingForm();
    form.parse(req, async (err: any, fields: any, files: any) => {
      const { audio: file } = files;
      const { finalFileName } = fields;
      if (err || !file) {
        res.status(500).send(err);
        return;
      }
      const filePath = file.path;
      const fileName = file.name;
      const contentType = file.contentType;

      const gcsPath = await uploadFileFromPath(
        bucket,
        filePath,
        fileName,
        contentType
      );
      const transcription = await transcribe(gcsPath);

      const url = await uploadDoc(
        bucket,
        finalFileName,
        transcription,
        "application/msword"
      );
      res.status(200).send(`Success: ${url}`);
    });
  });
