class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.25.0"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.25.0/calmlens-0.25.0-darwin-arm64.tar.gz"
      sha256 "921337deda4d5e8548ff9dbd7765a62ccce1cea70f7819163dc814c5021545d5"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.25.0/calmlens-0.25.0-darwin-x64.tar.gz"
      sha256 "8fb2e1d811182d7e829398aa4bd17a1e8abb2f175d9e4331267980fa0035f043"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.25.0/calmlens-0.25.0-linux-arm64.tar.gz"
      sha256 "0c20d8cf5fdbfe49b0a6a5d48698136f2fd7ba65a9d3b84a07e235c6088493b8"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.25.0/calmlens-0.25.0-linux-x64.tar.gz"
      sha256 "25075dddc54134b738a97f64ccb16d84e9b38e83508f00d7c09e06776814830e"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
