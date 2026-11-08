class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.22.0"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.22.0/calmlens-0.22.0-darwin-arm64.tar.gz"
      sha256 "320f3301640fea44b7bb3fc248332676f4daec53a9b75e04842c0a73f121a580"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.22.0/calmlens-0.22.0-darwin-x64.tar.gz"
      sha256 "d896aebd739cf28a9f4587fa4eafdcbc2e8c8453565b46411c460392cb698405"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.22.0/calmlens-0.22.0-linux-arm64.tar.gz"
      sha256 "ec8f2374a55f6edc3e2da952738cfe292e80131000f7c8f5681feb756f753471"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.22.0/calmlens-0.22.0-linux-x64.tar.gz"
      sha256 "ff590c80c273671f8b012743d577c45f99199e37824a58e52b3aaf06db5e6eed"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
