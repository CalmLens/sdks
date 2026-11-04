class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.19.0"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.19.0/calmlens-0.19.0-darwin-arm64.tar.gz"
      sha256 "78654d90081930f2f73fd29a6a0d19f0496b705d03b27da4bb34fa0fcebcca1f"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.19.0/calmlens-0.19.0-darwin-x64.tar.gz"
      sha256 "020c0f09eff8f748b9fcfeb63c1ac07466b42fa3b7eb3f3d589913f20a42d73e"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.19.0/calmlens-0.19.0-linux-arm64.tar.gz"
      sha256 "3d3d167a3a94d963adf87780bbbf1d7cc90437e9921e173ad0dbed34a47bb649"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.19.0/calmlens-0.19.0-linux-x64.tar.gz"
      sha256 "acfd47420332babb5d14893bfacb2ebb2527bceecb9a9dcd1cc1a10382aca301"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
