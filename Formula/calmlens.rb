class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.28.0"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.28.0/calmlens-0.28.0-darwin-arm64.tar.gz"
      sha256 "37a69d9055fa9ad55fd4a86a1030e03568913bc1864473ce487ecd6920ab6a9e"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.28.0/calmlens-0.28.0-darwin-x64.tar.gz"
      sha256 "708d19a6f8edd4dab3a8302d3923e8e9a9fdcbe201d8b37c54ded3047fef6be7"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.28.0/calmlens-0.28.0-linux-arm64.tar.gz"
      sha256 "88cae4e7b38eb767184e17caef3a5df938ef1534bda732b8babcb83963087007"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.28.0/calmlens-0.28.0-linux-x64.tar.gz"
      sha256 "f1f08459a62dce283a5e5f757e4a4d877e7dd80bc75b9a5ff06020ecab435f5b"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
