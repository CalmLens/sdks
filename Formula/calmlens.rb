class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.27.0"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.0/calmlens-0.27.0-darwin-arm64.tar.gz"
      sha256 "885750452dcf986e8f742af624ec0273bcfef0fb221d2ae1dee40417ccf8c7f3"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.0/calmlens-0.27.0-darwin-x64.tar.gz"
      sha256 "c686c421906629657791ac4ec33784a4d40977e9032da006a03c585c1543d0be"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.0/calmlens-0.27.0-linux-arm64.tar.gz"
      sha256 "b72f1acb1238d654674cc61008b581f97d4735dec6694a02e34c40c231fb1881"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.27.0/calmlens-0.27.0-linux-x64.tar.gz"
      sha256 "c1ed2fb76810fec26ab5990461b61721f46dbdabced259e5218aa791b22b1438"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
