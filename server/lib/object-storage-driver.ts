/**
 * Selects the object-storage backend at import time.
 *
 *   OBJECT_STORAGE_DRIVER=replit  (DEFAULT) -> Replit Object Storage
 *   OBJECT_STORAGE_DRIVER=azure             -> Azure Blob Storage
 *
 * WHY A SELECTOR RATHER THAN A REPOINT. This lands on `main` weeks before the
 * Azure cutover, and CWP's deploy mechanic on Replit is
 * `reset --hard origin/main` then Republish. If the call sites were hard-wired
 * to Azure, any hotfix Republish during the migration window would boot an app
 * whose brand-logo-cleanup sweep runs DefaultAzureCredential at boot and every
 * six hours against a host with no IMDS, no environment credential and no CLI.
 * It would throw in a loop, logo upload and serve would break, and invoice PDFs
 * would render logoless with no error — while also quietly invalidating the
 * migration's declared cold rollback ("just restart the Replit deployment").
 *
 * Defaulting to `replit` means main stays Replit-deployable until the moment
 * the Azure deployment sets the variable. server/replit_integrations/ is
 * deleted only after the soak.
 */
import {
  ObjectStorageService as ReplitObjectStorageService,
  objectStorageClient as replitObjectStorageClient,
  ObjectNotFoundError as ReplitObjectNotFoundError,
} from "../replit_integrations/object_storage";
import {
  AzureObjectStorageService,
  azureObjectStorageClient,
  ObjectNotFoundError as AzureObjectNotFoundError,
} from "./azure-object-storage";

const raw = (process.env.OBJECT_STORAGE_DRIVER || "replit").trim().toLowerCase();
export const objectStorageDriver: "replit" | "azure" =
  raw === "azure" ? "azure" : "replit";

if (raw && raw !== "replit" && raw !== "azure") {
  console.warn(
    `[object-storage] Unknown OBJECT_STORAGE_DRIVER="${raw}" — falling back to "replit".`,
  );
}

const isAzure = objectStorageDriver === "azure";

/**
 * The two implementations are structurally compatible across the surface the
 * call sites use — bucket().file().{save,delete,exists,getMetadata,
 * createReadStream}, bucket().getFiles(), and the service's
 * getPublicObjectSearchPaths / getPrivateObjectDir / searchPublicObject /
 * downloadObject — but they are nominally distinct classes, so the union is
 * widened here rather than at each of the three call sites.
 */
export const ObjectStorageService: any = isAzure
  ? AzureObjectStorageService
  : ReplitObjectStorageService;

export const objectStorageClient: any = isAzure
  ? azureObjectStorageClient
  : replitObjectStorageClient;

export const ObjectNotFoundError: any = isAzure
  ? AzureObjectNotFoundError
  : ReplitObjectNotFoundError;

console.log(`[object-storage] driver=${objectStorageDriver}`);
