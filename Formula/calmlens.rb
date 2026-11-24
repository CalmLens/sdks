class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.27.6"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.6/calmlens-0.27.6-darwin-arm64.tar.gz"
      sha256 "15ce6d3b55cd87f9a43ab1ee6ad599206d1d51ea30112f846505baddafcba6dd"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.6/calmlens-0.27.6-darwin-x64.tar.gz"
      sha256 "d43be7f2ec3dc0e76b8f675e67187a82af972895b868f6f77cf3897c0c134885"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.6/calmlens-0.27.6-linux-arm64.tar.gz"
      sha256 "54c180b144dab108b07388e6306f652e77b0643b14d4722c009cc32b2a4ef693"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.6/calmlens-0.27.6-linux-x64.tar.gz"
      sha256 "e207b833af4ef0812d96495f02a6b33ba8ebf7a63fc301dcf06c30cd1e09bbfc"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
