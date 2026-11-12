package com.calmlens;

import com.calmlens.models.*;
import com.calmlens.params.*;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.Executor;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * The asynchronous form of a {@link CalmLensServerClient}, from {@link CalmLensServerClient#async()}:
 * every method returns a {@link CompletableFuture} that completes with the result, or
 * exceptionally with the {@link com.calmlens.exception.CalmLensException} the call throws. Calls
 * run on the client's async executor (see {@link CalmLensServerClient.Builder#asyncExecutor}) and
 * share its connection, retries and lens cache. List with {@code list} and each page's {@code
 * nextCursor}; the lazy {@code iterate} methods are on the synchronous client. Cancelling a
 * future interrupts its call.
 */
public final class CalmLensServerClientAsync {
  private final CalmLensServerClient sync;
  private final Executor executor;
  private final AssetServiceAsync assets = new AssetServiceAsync();
  private final TextServiceAsync text = new TextServiceAsync();
  private final FolderServiceAsync folders = new FolderServiceAsync();
  private final HashListServiceAsync hashLists = new HashListServiceAsync();
  private final PolicyServiceAsync policies = new PolicyServiceAsync();
  private final LensServiceAsync lenses = new LensServiceAsync();
  private final UploadPresetServiceAsync uploadPresets = new UploadPresetServiceAsync();
  private final ProjectSettingsServiceAsync projectSettings = new ProjectSettingsServiceAsync();
  private final MetadataFieldServiceAsync metadataFields = new MetadataFieldServiceAsync();
  private final EventServiceAsync events = new EventServiceAsync();
  private final CdnServiceAsync cdn = new CdnServiceAsync();

  CalmLensServerClientAsync(CalmLensServerClient sync, Executor executor) {
    this.sync = sync;
    this.executor = executor;
  }

  /** @return the synchronous client these calls run on */
  public CalmLensServerClient sync() { return sync; }

  /** @return {@link CalmLensServerClient#assets()}, asynchronous */
  public AssetServiceAsync assets() { return assets; }

  /** @return {@link CalmLensServerClient#text()}, asynchronous */
  public TextServiceAsync text() { return text; }

  /** @return {@link CalmLensServerClient#folders()}, asynchronous */
  public FolderServiceAsync folders() { return folders; }

  /** @return {@link CalmLensServerClient#hashLists()}, asynchronous */
  public HashListServiceAsync hashLists() { return hashLists; }

  /** @return {@link CalmLensServerClient#policies()}, asynchronous */
  public PolicyServiceAsync policies() { return policies; }

  /** @return {@link CalmLensServerClient#lenses()}, asynchronous */
  public LensServiceAsync lenses() { return lenses; }

  /** @return {@link CalmLensServerClient#uploadPresets()}, asynchronous */
  public UploadPresetServiceAsync uploadPresets() { return uploadPresets; }

  /** @return {@link CalmLensServerClient#projectSettings()}, asynchronous */
  public ProjectSettingsServiceAsync projectSettings() { return projectSettings; }

  /** @return {@link CalmLensServerClient#metadataFields()}, asynchronous */
  public MetadataFieldServiceAsync metadataFields() { return metadataFields; }

  /** @return {@link CalmLensServerClient#events()}, asynchronous */
  public EventServiceAsync events() { return events; }

  /** @return {@link CalmLensServerClient#cdn()}, asynchronous */
  public CdnServiceAsync cdn() { return cdn; }

  /**
   * {@link CalmLensServerClient#ensureLens(LensCreateParams)}, run on the async executor.
   *
   * @return the result, or the exception the call throws
   */
  public CompletableFuture<Lens> ensureLens(LensCreateParams params) { return run(() -> sync.ensureLens(params)); }
  /**
   * {@link CalmLensServerClient#ensureLenses(List)}, run on the async executor.
   *
   * @return the result, or the exception the call throws
   */
  public CompletableFuture<List<Lens>> ensureLenses(List<LensCreateParams> lenses) { return run(() -> sync.ensureLenses(lenses)); }
  /**
   * {@link CalmLensServerClient#ensureLenses(List, RequestOptions)}, run on the async executor.
   *
   * @return the result, or the exception the call throws
   */
  public CompletableFuture<List<Lens>> ensureLenses(List<LensCreateParams> lenses, @Nullable RequestOptions requestOptions) { return run(() -> sync.ensureLenses(lenses, requestOptions)); }
  /**
   * {@link CalmLensServerClient#request(String, String)}, run on the async executor.
   *
   * @return the result, or the exception the call throws
   */
  public CompletableFuture<RawResponse> request(String method, String path) { return run(() -> sync.request(method, path)); }
  /**
   * {@link CalmLensServerClient#request(String, String, Map, Object, RequestOptions)}, run on the async executor.
   *
   * @return the result, or the exception the call throws
   */
  public CompletableFuture<RawResponse> request(String method, String path, @Nullable Map<String, ?> query, @Nullable Object body, @Nullable RequestOptions requestOptions) { return run(() -> sync.request(method, path, query, body, requestOptions)); }

  private <T> CompletableFuture<T> run(Supplier<T> call) {
    CompletableFuture<T> future = new CompletableFuture<>();
    Thread[] runner = {null};
    executor.execute(() -> {
      synchronized (runner) {
        if (future.isDone()) return;
        runner[0] = Thread.currentThread();
      }
      try {
        future.complete(call.get());
      } catch (RuntimeException failure) {
        future.completeExceptionally(failure instanceof CompletionException completion && completion.getCause() != null ? completion.getCause() : failure);
      } finally {
        synchronized (runner) {
          runner[0] = null;
          Thread.interrupted();
        }
      }
    });
    future.whenComplete((value, failure) -> {
      if (future.isCancelled()) synchronized (runner) { if (runner[0] != null) runner[0].interrupt(); }
    });
    return future;
  }

  /** {@link CalmLensServerClient.AssetService}, asynchronous. */
  public final class AssetServiceAsync {
    private AssetServiceAsync() {}

    /**
     * {@link CalmLensServerClient.AssetService#create(AssetCreateParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> create(AssetCreateParams params) { return run(() -> sync.assets().create(params)); }

    /**
     * {@link CalmLensServerClient.AssetService#create(AssetCreateParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> create(AssetCreateParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.assets().create(params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.AssetService#create(String, byte[], String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> create(String name, byte[] bytes, String mimeType) { return run(() -> sync.assets().create(name, bytes, mimeType)); }

    /**
     * {@link CalmLensServerClient.AssetService#classify(AssetCreateParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> classify(AssetCreateParams params) { return run(() -> sync.assets().classify(params)); }

    /**
     * {@link CalmLensServerClient.AssetService#classify(AssetCreateParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> classify(AssetCreateParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.assets().classify(params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.AssetService#search(AssetSearchParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<AssetSearchResponse> search(AssetSearchParams params) { return run(() -> sync.assets().search(params)); }

    /**
     * {@link CalmLensServerClient.AssetService#search(AssetSearchParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<AssetSearchResponse> search(AssetSearchParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.assets().search(params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.AssetService#list()}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<AssetPage> list() { return run(() -> sync.assets().list()); }

    /**
     * {@link CalmLensServerClient.AssetService#list(AssetListParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<AssetPage> list(@Nullable AssetListParams params) { return run(() -> sync.assets().list(params)); }

    /**
     * {@link CalmLensServerClient.AssetService#list(AssetListParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<AssetPage> list(@Nullable AssetListParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.assets().list(params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.AssetService#retrieve(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> retrieve(String assetId) { return run(() -> sync.assets().retrieve(assetId)); }

    /**
     * {@link CalmLensServerClient.AssetService#retrieve(String, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> retrieve(String assetId, @Nullable RequestOptions requestOptions) { return run(() -> sync.assets().retrieve(assetId, requestOptions)); }

    /**
     * {@link CalmLensServerClient.AssetService#waitForDecision(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> waitForDecision(String assetId) { return run(() -> sync.assets().waitForDecision(assetId)); }

    /**
     * {@link CalmLensServerClient.AssetService#waitForDecision(String, Duration)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> waitForDecision(String assetId, @Nullable Duration timeout) { return run(() -> sync.assets().waitForDecision(assetId, timeout)); }

    /**
     * {@link CalmLensServerClient.AssetService#waitForDecision(String, Duration, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> waitForDecision(String assetId, @Nullable Duration timeout, @Nullable RequestOptions requestOptions) { return run(() -> sync.assets().waitForDecision(assetId, timeout, requestOptions)); }

    /**
     * {@link CalmLensServerClient.AssetService#update(String, AssetUpdateParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> update(String assetId, AssetUpdateParams params) { return run(() -> sync.assets().update(assetId, params)); }

    /**
     * {@link CalmLensServerClient.AssetService#update(String, AssetUpdateParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> update(String assetId, AssetUpdateParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.assets().update(assetId, params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.AssetService#retry(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> retry(String assetId) { return run(() -> sync.assets().retry(assetId)); }

    /**
     * {@link CalmLensServerClient.AssetService#retry(String, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> retry(String assetId, @Nullable RequestOptions requestOptions) { return run(() -> sync.assets().retry(assetId, requestOptions)); }

    /**
     * {@link CalmLensServerClient.AssetService#decide(String, AssetDecideParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> decide(String assetId, AssetDecideParams params) { return run(() -> sync.assets().decide(assetId, params)); }

    /**
     * {@link CalmLensServerClient.AssetService#decide(String, AssetDecideParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> decide(String assetId, AssetDecideParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.assets().decide(assetId, params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.AssetService#explain(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> explain(String assetId) { return run(() -> sync.assets().explain(assetId)); }

    /**
     * {@link CalmLensServerClient.AssetService#explain(String, AssetExplainParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> explain(String assetId, @Nullable AssetExplainParams params) { return run(() -> sync.assets().explain(assetId, params)); }

    /**
     * {@link CalmLensServerClient.AssetService#explain(String, AssetExplainParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> explain(String assetId, @Nullable AssetExplainParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.assets().explain(assetId, params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.AssetService#removeContent(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> removeContent(String assetId) { return run(() -> sync.assets().removeContent(assetId)); }

    /**
     * {@link CalmLensServerClient.AssetService#removeContent(String, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> removeContent(String assetId, @Nullable RequestOptions requestOptions) { return run(() -> sync.assets().removeContent(assetId, requestOptions)); }

    /**
     * {@link CalmLensServerClient.AssetService#delete(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Void> delete(String assetId) { return run(() -> { sync.assets().delete(assetId); return null; }); }

    /**
     * {@link CalmLensServerClient.AssetService#delete(String, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Void> delete(String assetId, @Nullable RequestOptions requestOptions) { return run(() -> { sync.assets().delete(assetId, requestOptions); return null; }); }

    /**
     * {@link CalmLensServerClient.AssetService#batch(AssetBatchParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<BatchAssetsResponse> batch(AssetBatchParams params) { return run(() -> sync.assets().batch(params)); }

    /**
     * {@link CalmLensServerClient.AssetService#batch(AssetBatchParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<BatchAssetsResponse> batch(AssetBatchParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.assets().batch(params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.AssetService#move(String, AssetMoveParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> move(String assetId, AssetMoveParams params) { return run(() -> sync.assets().move(assetId, params)); }

    /**
     * {@link CalmLensServerClient.AssetService#move(String, AssetMoveParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> move(String assetId, AssetMoveParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.assets().move(assetId, params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.AssetService#listChildren(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<AssetPage> listChildren(String assetId) { return run(() -> sync.assets().listChildren(assetId)); }

    /**
     * {@link CalmLensServerClient.AssetService#listChildren(String, AssetListChildrenParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<AssetPage> listChildren(String assetId, @Nullable AssetListChildrenParams params) { return run(() -> sync.assets().listChildren(assetId, params)); }

    /**
     * {@link CalmLensServerClient.AssetService#listChildren(String, AssetListChildrenParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<AssetPage> listChildren(String assetId, @Nullable AssetListChildrenParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.assets().listChildren(assetId, params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.AssetService#listTimeline(String, AssetListTimelineParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<AssetTimelinePage> listTimeline(String assetId, @Nullable AssetListTimelineParams params) { return run(() -> sync.assets().listTimeline(assetId, params)); }

    /**
     * {@link CalmLensServerClient.AssetService#listTimeline(String, AssetListTimelineParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<AssetTimelinePage> listTimeline(String assetId, @Nullable AssetListTimelineParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.assets().listTimeline(assetId, params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.AssetService#uploadPart(String, AssetUploadPartParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> uploadPart(String assetId, AssetUploadPartParams params) { return run(() -> sync.assets().uploadPart(assetId, params)); }

    /**
     * {@link CalmLensServerClient.AssetService#uploadPart(String, AssetUploadPartParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> uploadPart(String assetId, AssetUploadPartParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.assets().uploadPart(assetId, params, requestOptions)); }
  }

  /** {@link CalmLensServerClient.TextService}, asynchronous. */
  public final class TextServiceAsync {
    private TextServiceAsync() {}

    /**
     * {@link CalmLensServerClient.TextService#classify(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> classify(String text) { return run(() -> sync.text().classify(text)); }

    /**
     * {@link CalmLensServerClient.TextService#classify(TextClassifyParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> classify(TextClassifyParams params) { return run(() -> sync.text().classify(params)); }

    /**
     * {@link CalmLensServerClient.TextService#classify(TextClassifyParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Asset> classify(TextClassifyParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.text().classify(params, requestOptions)); }
  }

  /** {@link CalmLensServerClient.FolderService}, asynchronous. */
  public final class FolderServiceAsync {
    private FolderServiceAsync() {}

    /**
     * {@link CalmLensServerClient.FolderService#list()}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<FolderPage> list() { return run(() -> sync.folders().list()); }

    /**
     * {@link CalmLensServerClient.FolderService#list(FolderListParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<FolderPage> list(@Nullable FolderListParams params) { return run(() -> sync.folders().list(params)); }

    /**
     * {@link CalmLensServerClient.FolderService#list(FolderListParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<FolderPage> list(@Nullable FolderListParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.folders().list(params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.FolderService#retrieve(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Folder> retrieve(String folderId) { return run(() -> sync.folders().retrieve(folderId)); }

    /**
     * {@link CalmLensServerClient.FolderService#retrieve(String, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Folder> retrieve(String folderId, @Nullable RequestOptions requestOptions) { return run(() -> sync.folders().retrieve(folderId, requestOptions)); }

    /**
     * {@link CalmLensServerClient.FolderService#create(FolderCreateParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Folder> create(FolderCreateParams params) { return run(() -> sync.folders().create(params)); }

    /**
     * {@link CalmLensServerClient.FolderService#create(FolderCreateParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Folder> create(FolderCreateParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.folders().create(params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.FolderService#update(String, FolderUpdateParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Folder> update(String folderId, FolderUpdateParams params) { return run(() -> sync.folders().update(folderId, params)); }

    /**
     * {@link CalmLensServerClient.FolderService#update(String, FolderUpdateParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Folder> update(String folderId, FolderUpdateParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.folders().update(folderId, params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.FolderService#move(String, FolderMoveParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Folder> move(String folderId, FolderMoveParams params) { return run(() -> sync.folders().move(folderId, params)); }

    /**
     * {@link CalmLensServerClient.FolderService#move(String, FolderMoveParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Folder> move(String folderId, FolderMoveParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.folders().move(folderId, params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.FolderService#delete(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Void> delete(String folderId) { return run(() -> { sync.folders().delete(folderId); return null; }); }

    /**
     * {@link CalmLensServerClient.FolderService#delete(String, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Void> delete(String folderId, @Nullable RequestOptions requestOptions) { return run(() -> { sync.folders().delete(folderId, requestOptions); return null; }); }
  }

  /** {@link CalmLensServerClient.HashListService}, asynchronous. */
  public final class HashListServiceAsync {
    private HashListServiceAsync() {}

    /**
     * {@link CalmLensServerClient.HashListService#list()}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<HashListPage> list() { return run(() -> sync.hashLists().list()); }

    /**
     * {@link CalmLensServerClient.HashListService#list(HashListListParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<HashListPage> list(@Nullable HashListListParams params) { return run(() -> sync.hashLists().list(params)); }

    /**
     * {@link CalmLensServerClient.HashListService#list(HashListListParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<HashListPage> list(@Nullable HashListListParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.hashLists().list(params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.HashListService#retrieve(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<HashList> retrieve(String hashListId) { return run(() -> sync.hashLists().retrieve(hashListId)); }

    /**
     * {@link CalmLensServerClient.HashListService#retrieve(String, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<HashList> retrieve(String hashListId, @Nullable RequestOptions requestOptions) { return run(() -> sync.hashLists().retrieve(hashListId, requestOptions)); }

    /**
     * {@link CalmLensServerClient.HashListService#create(HashListCreateParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<HashList> create(HashListCreateParams params) { return run(() -> sync.hashLists().create(params)); }

    /**
     * {@link CalmLensServerClient.HashListService#create(HashListCreateParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<HashList> create(HashListCreateParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.hashLists().create(params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.HashListService#update(String, HashListUpdateParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<HashList> update(String hashListId, HashListUpdateParams params) { return run(() -> sync.hashLists().update(hashListId, params)); }

    /**
     * {@link CalmLensServerClient.HashListService#update(String, HashListUpdateParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<HashList> update(String hashListId, HashListUpdateParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.hashLists().update(hashListId, params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.HashListService#delete(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Void> delete(String hashListId) { return run(() -> { sync.hashLists().delete(hashListId); return null; }); }

    /**
     * {@link CalmLensServerClient.HashListService#delete(String, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Void> delete(String hashListId, @Nullable RequestOptions requestOptions) { return run(() -> { sync.hashLists().delete(hashListId, requestOptions); return null; }); }

    /**
     * {@link CalmLensServerClient.HashListService#listEntries(String, HashListListEntriesParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<HashListEntryPage> listEntries(String hashListId, @Nullable HashListListEntriesParams params) { return run(() -> sync.hashLists().listEntries(hashListId, params)); }

    /**
     * {@link CalmLensServerClient.HashListService#listEntries(String, HashListListEntriesParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<HashListEntryPage> listEntries(String hashListId, @Nullable HashListListEntriesParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.hashLists().listEntries(hashListId, params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.HashListService#addEntry(String, HashListAddEntryParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<HashListEntry> addEntry(String hashListId, HashListAddEntryParams params) { return run(() -> sync.hashLists().addEntry(hashListId, params)); }

    /**
     * {@link CalmLensServerClient.HashListService#addEntry(String, HashListAddEntryParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<HashListEntry> addEntry(String hashListId, HashListAddEntryParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.hashLists().addEntry(hashListId, params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.HashListService#removeEntry(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Void> removeEntry(String entryId) { return run(() -> { sync.hashLists().removeEntry(entryId); return null; }); }

    /**
     * {@link CalmLensServerClient.HashListService#removeEntry(String, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Void> removeEntry(String entryId, @Nullable RequestOptions requestOptions) { return run(() -> { sync.hashLists().removeEntry(entryId, requestOptions); return null; }); }
  }

  /** {@link CalmLensServerClient.PolicyService}, asynchronous. */
  public final class PolicyServiceAsync {
    private PolicyServiceAsync() {}

    /**
     * {@link CalmLensServerClient.PolicyService#list()}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<PolicyPage> list() { return run(() -> sync.policies().list()); }

    /**
     * {@link CalmLensServerClient.PolicyService#list(PolicyListParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<PolicyPage> list(@Nullable PolicyListParams params) { return run(() -> sync.policies().list(params)); }

    /**
     * {@link CalmLensServerClient.PolicyService#list(PolicyListParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<PolicyPage> list(@Nullable PolicyListParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.policies().list(params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.PolicyService#retrieve(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Policy> retrieve(String policyId) { return run(() -> sync.policies().retrieve(policyId)); }

    /**
     * {@link CalmLensServerClient.PolicyService#retrieve(String, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Policy> retrieve(String policyId, @Nullable RequestOptions requestOptions) { return run(() -> sync.policies().retrieve(policyId, requestOptions)); }

    /**
     * {@link CalmLensServerClient.PolicyService#create(PolicyCreateParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Policy> create(PolicyCreateParams params) { return run(() -> sync.policies().create(params)); }

    /**
     * {@link CalmLensServerClient.PolicyService#create(PolicyCreateParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Policy> create(PolicyCreateParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.policies().create(params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.PolicyService#update(String, PolicyUpdateParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Policy> update(String policyId, PolicyUpdateParams params) { return run(() -> sync.policies().update(policyId, params)); }

    /**
     * {@link CalmLensServerClient.PolicyService#update(String, PolicyUpdateParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Policy> update(String policyId, PolicyUpdateParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.policies().update(policyId, params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.PolicyService#reset(String, PolicyResetParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Policy> reset(String policyId, PolicyResetParams params) { return run(() -> sync.policies().reset(policyId, params)); }

    /**
     * {@link CalmLensServerClient.PolicyService#reset(String, PolicyResetParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Policy> reset(String policyId, PolicyResetParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.policies().reset(policyId, params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.PolicyService#upgrade(String, PolicyUpgradeParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Policy> upgrade(String policyId, PolicyUpgradeParams params) { return run(() -> sync.policies().upgrade(policyId, params)); }

    /**
     * {@link CalmLensServerClient.PolicyService#upgrade(String, PolicyUpgradeParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Policy> upgrade(String policyId, PolicyUpgradeParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.policies().upgrade(policyId, params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.PolicyService#setAutomaticUpdates(String, PolicySetAutomaticUpdatesParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Policy> setAutomaticUpdates(String policyId, PolicySetAutomaticUpdatesParams params) { return run(() -> sync.policies().setAutomaticUpdates(policyId, params)); }

    /**
     * {@link CalmLensServerClient.PolicyService#setAutomaticUpdates(String, PolicySetAutomaticUpdatesParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Policy> setAutomaticUpdates(String policyId, PolicySetAutomaticUpdatesParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.policies().setAutomaticUpdates(policyId, params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.PolicyService#delete(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Void> delete(String policyId) { return run(() -> { sync.policies().delete(policyId); return null; }); }

    /**
     * {@link CalmLensServerClient.PolicyService#delete(String, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Void> delete(String policyId, @Nullable RequestOptions requestOptions) { return run(() -> { sync.policies().delete(policyId, requestOptions); return null; }); }

    /**
     * {@link CalmLensServerClient.PolicyService#retrieveAssigned()}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Policy> retrieveAssigned() { return run(() -> sync.policies().retrieveAssigned()); }

    /**
     * {@link CalmLensServerClient.PolicyService#retrieveAssigned(RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Policy> retrieveAssigned(@Nullable RequestOptions requestOptions) { return run(() -> sync.policies().retrieveAssigned(requestOptions)); }

    /**
     * {@link CalmLensServerClient.PolicyService#assign(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Policy> assign(String policyId) { return run(() -> sync.policies().assign(policyId)); }

    /**
     * {@link CalmLensServerClient.PolicyService#assign(String, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Policy> assign(String policyId, @Nullable RequestOptions requestOptions) { return run(() -> sync.policies().assign(policyId, requestOptions)); }
  }

  /** {@link CalmLensServerClient.LensService}, asynchronous. */
  public final class LensServiceAsync {
    private LensServiceAsync() {}

    /**
     * {@link CalmLensServerClient.LensService#list()}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<LensPage> list() { return run(() -> sync.lenses().list()); }

    /**
     * {@link CalmLensServerClient.LensService#list(LensListParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<LensPage> list(@Nullable LensListParams params) { return run(() -> sync.lenses().list(params)); }

    /**
     * {@link CalmLensServerClient.LensService#list(LensListParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<LensPage> list(@Nullable LensListParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.lenses().list(params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.LensService#create(LensCreateParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Lens> create(LensCreateParams params) { return run(() -> sync.lenses().create(params)); }

    /**
     * {@link CalmLensServerClient.LensService#create(LensCreateParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Lens> create(LensCreateParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.lenses().create(params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.LensService#retrieve(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Lens> retrieve(String lensId) { return run(() -> sync.lenses().retrieve(lensId)); }

    /**
     * {@link CalmLensServerClient.LensService#retrieve(String, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Lens> retrieve(String lensId, @Nullable RequestOptions requestOptions) { return run(() -> sync.lenses().retrieve(lensId, requestOptions)); }

    /**
     * {@link CalmLensServerClient.LensService#update(String, LensUpdateParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Lens> update(String lensId, LensUpdateParams params) { return run(() -> sync.lenses().update(lensId, params)); }

    /**
     * {@link CalmLensServerClient.LensService#update(String, LensUpdateParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Lens> update(String lensId, LensUpdateParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.lenses().update(lensId, params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.LensService#delete(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Void> delete(String lensId) { return run(() -> { sync.lenses().delete(lensId); return null; }); }

    /**
     * {@link CalmLensServerClient.LensService#delete(String, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Void> delete(String lensId, @Nullable RequestOptions requestOptions) { return run(() -> { sync.lenses().delete(lensId, requestOptions); return null; }); }
  }

  /** {@link CalmLensServerClient.UploadPresetService}, asynchronous. */
  public final class UploadPresetServiceAsync {
    private UploadPresetServiceAsync() {}

    /**
     * {@link CalmLensServerClient.UploadPresetService#list()}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<UploadPresetPage> list() { return run(() -> sync.uploadPresets().list()); }

    /**
     * {@link CalmLensServerClient.UploadPresetService#list(UploadPresetListParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<UploadPresetPage> list(@Nullable UploadPresetListParams params) { return run(() -> sync.uploadPresets().list(params)); }

    /**
     * {@link CalmLensServerClient.UploadPresetService#list(UploadPresetListParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<UploadPresetPage> list(@Nullable UploadPresetListParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.uploadPresets().list(params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.UploadPresetService#ensure(List)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<EnsureUploadPresetsResponse> ensure(List<UploadPresetParams> uploadPresets) { return run(() -> sync.uploadPresets().ensure(uploadPresets)); }

    /**
     * {@link CalmLensServerClient.UploadPresetService#ensure(List, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<EnsureUploadPresetsResponse> ensure(List<UploadPresetParams> uploadPresets, @Nullable RequestOptions requestOptions) { return run(() -> sync.uploadPresets().ensure(uploadPresets, requestOptions)); }

    /**
     * {@link CalmLensServerClient.UploadPresetService#delete(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Void> delete(String uploadPresetId) { return run(() -> { sync.uploadPresets().delete(uploadPresetId); return null; }); }

    /**
     * {@link CalmLensServerClient.UploadPresetService#delete(String, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Void> delete(String uploadPresetId, @Nullable RequestOptions requestOptions) { return run(() -> { sync.uploadPresets().delete(uploadPresetId, requestOptions); return null; }); }
  }

  /** {@link CalmLensServerClient.ProjectSettingsService}, asynchronous. */
  public final class ProjectSettingsServiceAsync {
    private ProjectSettingsServiceAsync() {}

    /**
     * {@link CalmLensServerClient.ProjectSettingsService#get()}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<ProjectSettingsResource> get() { return run(() -> sync.projectSettings().get()); }

    /**
     * {@link CalmLensServerClient.ProjectSettingsService#get(RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<ProjectSettingsResource> get(@Nullable RequestOptions requestOptions) { return run(() -> sync.projectSettings().get(requestOptions)); }

    /**
     * {@link CalmLensServerClient.ProjectSettingsService#update(ProjectSettingsUpdateParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<ProjectSettingsResource> update(ProjectSettingsUpdateParams params) { return run(() -> sync.projectSettings().update(params)); }

    /**
     * {@link CalmLensServerClient.ProjectSettingsService#update(ProjectSettingsUpdateParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<ProjectSettingsResource> update(ProjectSettingsUpdateParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.projectSettings().update(params, requestOptions)); }
  }

  /** {@link CalmLensServerClient.MetadataFieldService}, asynchronous. */
  public final class MetadataFieldServiceAsync {
    private MetadataFieldServiceAsync() {}

    /**
     * {@link CalmLensServerClient.MetadataFieldService#list()}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<MetadataFieldsResource> list() { return run(() -> sync.metadataFields().list()); }

    /**
     * {@link CalmLensServerClient.MetadataFieldService#list(RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<MetadataFieldsResource> list(@Nullable RequestOptions requestOptions) { return run(() -> sync.metadataFields().list(requestOptions)); }

    /**
     * {@link CalmLensServerClient.MetadataFieldService#ensure(MetadataFieldsEnsureParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<MetadataFieldsResource> ensure(MetadataFieldsEnsureParams params) { return run(() -> sync.metadataFields().ensure(params)); }

    /**
     * {@link CalmLensServerClient.MetadataFieldService#ensure(MetadataFieldsEnsureParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<MetadataFieldsResource> ensure(MetadataFieldsEnsureParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.metadataFields().ensure(params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.MetadataFieldService#delete(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Void> delete(String fieldId) { return run(() -> { sync.metadataFields().delete(fieldId); return null; }); }

    /**
     * {@link CalmLensServerClient.MetadataFieldService#delete(String, MetadataFieldsDeleteParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Void> delete(String fieldId, @Nullable MetadataFieldsDeleteParams params) { return run(() -> { sync.metadataFields().delete(fieldId, params); return null; }); }

    /**
     * {@link CalmLensServerClient.MetadataFieldService#delete(String, MetadataFieldsDeleteParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<Void> delete(String fieldId, @Nullable MetadataFieldsDeleteParams params, @Nullable RequestOptions requestOptions) { return run(() -> { sync.metadataFields().delete(fieldId, params, requestOptions); return null; }); }
  }

  /** {@link CalmLensServerClient.EventService}, asynchronous. */
  public final class EventServiceAsync {
    private EventServiceAsync() {}

    /**
     * {@link CalmLensServerClient.EventService#list()}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<EventsPage> list() { return run(() -> sync.events().list()); }

    /**
     * {@link CalmLensServerClient.EventService#list(EventListParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<EventsPage> list(@Nullable EventListParams params) { return run(() -> sync.events().list(params)); }

    /**
     * {@link CalmLensServerClient.EventService#list(EventListParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<EventsPage> list(@Nullable EventListParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.events().list(params, requestOptions)); }
  }

  /** {@link CalmLensServerClient.CdnService}, asynchronous. */
  public final class CdnServiceAsync {
    private CdnServiceAsync() {}

    /**
     * {@link CalmLensServerClient.CdnService#getAssetUrl(CdnRequestParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<String> getAssetUrl(CdnRequestParams params) { return run(() -> sync.cdn().getAssetUrl(params)); }

    /**
     * {@link CalmLensServerClient.CdnService#signAssetUrl(CdnSignAssetUrlParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<SignedAssetUrl> signAssetUrl(CdnSignAssetUrlParams params) { return run(() -> sync.cdn().signAssetUrl(params)); }

    /**
     * {@link CalmLensServerClient.CdnService#signAssetUrl(CdnSignAssetUrlParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<SignedAssetUrl> signAssetUrl(CdnSignAssetUrlParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.cdn().signAssetUrl(params, requestOptions)); }

    /**
     * {@link CalmLensServerClient.CdnService#getAssetInfo(String)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<AssetInfo> getAssetInfo(String url) { return run(() -> sync.cdn().getAssetInfo(url)); }

    /**
     * {@link CalmLensServerClient.CdnService#getAssetInfo(String, ViewerClaims)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<AssetInfo> getAssetInfo(String url, @Nullable ViewerClaims viewerClaims) { return run(() -> sync.cdn().getAssetInfo(url, viewerClaims)); }

    /**
     * {@link CalmLensServerClient.CdnService#getAssetInfo(String, ViewerClaims, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<AssetInfo> getAssetInfo(String url, @Nullable ViewerClaims viewerClaims, @Nullable RequestOptions requestOptions) { return run(() -> sync.cdn().getAssetInfo(url, viewerClaims, requestOptions)); }

    /**
     * {@link CalmLensServerClient.CdnService#serve(CdnRequestParams)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<CdnResponse> serve(CdnRequestParams params) { return run(() -> sync.cdn().serve(params)); }

    /**
     * {@link CalmLensServerClient.CdnService#serve(CdnRequestParams, RequestOptions)}, run on the async executor.
     *
     * @return the result, or the exception the call throws
     */
    public CompletableFuture<CdnResponse> serve(CdnRequestParams params, @Nullable RequestOptions requestOptions) { return run(() -> sync.cdn().serve(params, requestOptions)); }
  }
}
