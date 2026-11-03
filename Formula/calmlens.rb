class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.18.1"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.18.1/calmlens-0.18.1-darwin-arm64.tar.gz"
      sha256 "088ca5996b308907d75c41804da48a097fbf1645d383445238fd4f1ff13f16c6"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.18.1/calmlens-0.18.1-darwin-x64.tar.gz"
      sha256 "bd687c3904ee890821e2581849dd1bc6d1e55eab9fe06c0c172732cbeba99948"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.18.1/calmlens-0.18.1-linux-arm64.tar.gz"
      sha256 "ea7d1623a0ee10a7baf2d978c3bec960066d13b8f4fda7047caa2ef18dfc0c5d"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.18.1/calmlens-0.18.1-linux-x64.tar.gz"
      sha256 "f06a67c47331cba49db857baaf8753cb0056ed7eb1d4ce6fbb3cff8fd340d646"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
