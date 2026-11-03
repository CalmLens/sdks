class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.18.0"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.18.0/calmlens-0.18.0-darwin-arm64.tar.gz"
      sha256 "fc338974cb38f9ef255e9323cffc7539c57e490f34f1e9bab59759145469c0b4"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.18.0/calmlens-0.18.0-darwin-x64.tar.gz"
      sha256 "1c867f7855161404295459a38e5a2aef9c91cabde7bffff5ab67b30c5b5c9f51"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.18.0/calmlens-0.18.0-linux-arm64.tar.gz"
      sha256 "2a605401bf3c3ed119e09503a0ad179b5fdcef5a4667031a932ddfd9d3024ce6"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.18.0/calmlens-0.18.0-linux-x64.tar.gz"
      sha256 "7f6bc9a1efe0e000df308024a30bb5d785acc7e7899eae409dd7761168ee828e"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
