export type RetrievalProgressStage =
  | "fast"
  | "enumerating"
  | "scanning"
  | "extracting";

export type RetrievalProgress = (stage: RetrievalProgressStage) => void;
