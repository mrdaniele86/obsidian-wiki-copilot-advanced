import type { TranslationKey, TranslationVariables } from "../i18n";
import {
  ModelConfigurationError,
  ModelRequestError,
  ModelStreamInterruptedError,
  StreamFallbackRequiredError
} from "../llm/openai-compatible";
import type { ModelResponseDetail } from "../llm/openai-compatible";

type Translator = (key: TranslationKey, variables?: TranslationVariables) => string;

export function localizeModelResponseDetail(t: Translator, detail: ModelResponseDetail): string {
  const keys: Readonly<Record<ModelResponseDetail, TranslationKey>> = {
    "streaming-unavailable": "view.model.streamingUnavailable",
    "streaming-unsupported": "view.model.streamingUnsupported",
    "complete-response": "view.model.completeResponse"
  };
  return t(keys[detail]);
}

export function localizeModelError(t: Translator, error: unknown): string {
  if (error instanceof ModelRequestError) {
    if (error.code === "empty-response") {
      return t("view.model.emptyResponse");
    }
    return t("view.model.requestFailed", { detail: error.detail ?? "" });
  }
  if (error instanceof ModelConfigurationError) {
    const keys: Readonly<Record<ModelConfigurationError["code"], TranslationKey>> = {
      "invalid-endpoint": "view.model.invalidEndpoint",
      "missing-service-name": "view.model.missingServiceName",
      "missing-endpoint-or-model": "view.model.missingEndpointOrModel",
      "missing-api-key": "view.model.missingApiKey"
    };
    return t(keys[error.code]);
  }
  if (error instanceof ModelStreamInterruptedError) {
    const keys: Readonly<Record<ModelStreamInterruptedError["reason"], TranslationKey>> = {
      "insufficient-system-resource": "view.model.insufficientSystemResource",
      "stream-interrupted": "view.model.streamInterrupted"
    };
    return t(keys[error.reason]);
  }
  if (error instanceof StreamFallbackRequiredError) {
    const keys: Readonly<Record<StreamFallbackRequiredError["reason"], TranslationKey>> = {
      "streaming-unavailable": "view.model.streamingUnavailableRetry",
      "response-not-streamable": "view.model.responseNotStreamable",
      "stream-connection-failed": "view.model.streamConnectionFailed"
    };
    return t(keys[error.reason]);
  }
  return error instanceof Error ? error.message : String(error);
}
