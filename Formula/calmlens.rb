class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.18.2"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.18.2/calmlens-0.18.2-darwin-arm64.tar.gz"
      sha256 "e1d5a28e5e409946d51d8b964ae484c0b658fc0a439eb2be9c5de7fbfd45d39b"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.18.2/calmlens-0.18.2-darwin-x64.tar.gz"
      sha256 "55dd76f6088b57f5b88207f6362e2d7f953bded4381b4ddde1b4166130b04bf5"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.18.2/calmlens-0.18.2-linux-arm64.tar.gz"
      sha256 "ca1abc683464a4b833b8d84e4ff22b94ab08d0e37d4777741b66c79ab3339517"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.18.2/calmlens-0.18.2-linux-x64.tar.gz"
      sha256 "b515f1ba998195a9c0f3debc1e5351b74268496b6f4dd6f8b6b6faa3572d199b"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
