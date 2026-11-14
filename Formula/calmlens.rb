class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.26.0"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.26.0/calmlens-0.26.0-darwin-arm64.tar.gz"
      sha256 "1fe55e6a55186bdc4e877bcfca458bcd4a9ce6eaf2dac5d550099010099c74fd"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.26.0/calmlens-0.26.0-darwin-x64.tar.gz"
      sha256 "474bbd795a908f01ac9b1b45549fedc246c1effbaecb53b736e52efb625e4e39"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.26.0/calmlens-0.26.0-linux-arm64.tar.gz"
      sha256 "3d7843f8b817d61738b9ded0e1c01751f8609b5697b03246a312ca5693f1c780"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.26.0/calmlens-0.26.0-linux-x64.tar.gz"
      sha256 "49f84672dcf57e5a5061dd195f8a4c251f8806679b6bfd7e0714a358e7d3c7c5"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
