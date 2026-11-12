package com.calmlens.models;

import com.calmlens.internal.Required;

/**
 * A project's settings and their revision.
 */
public final class ProjectSettingsResource extends CalmLensObject {
  @Required private String projectId;
  @Required private Integer revision;
  @Required private ProjectSettings settings;

  private ProjectSettingsResource() {}

  /** @return the project */
  public String getProjectId() { return required(projectId, "projectId"); }

  /** @return changes with every real change; metadata fields share it */
  public int getRevision() { return required(revision, "revision"); }

  /** @return the settings */
  public ProjectSettings getSettings() { return required(settings, "settings"); }
}
