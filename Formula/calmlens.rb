class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.23.1"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.23.1/calmlens-0.23.1-darwin-arm64.tar.gz"
      sha256 "b1f4effeb9b0cb43af8f9379f8a8eb25b1b108bc960245bea00202eaa331eae7"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.23.1/calmlens-0.23.1-darwin-x64.tar.gz"
      sha256 "51142738783bb7c9c5130ae07d6c9227265958c657b831f4323b4063542aac12"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.23.1/calmlens-0.23.1-linux-arm64.tar.gz"
      sha256 "bb9e13cc6e076644d1224b53634a65a9a4b6d94e6157fa34c96c5165c99b9dee"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.23.1/calmlens-0.23.1-linux-x64.tar.gz"
      sha256 "de2f9f4936cad1dec9d658c2dfa5adb21b3076281984d773d485125872341dd3"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
